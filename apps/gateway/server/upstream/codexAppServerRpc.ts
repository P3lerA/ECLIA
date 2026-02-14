import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

type JsonRpcMessage =
  | { id: number; result: JsonValue }
  | { id: number; error: { code?: number; message?: string } }
  | { id: number; method: string; params?: any }
  | { method: string; params?: any };

function safeJsonParse(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export type CodexAppServerRpc = {
  proc: ChildProcessWithoutNullStreams;
  request: (method: string, params?: any) => Promise<any>;
  notify: (method: string, params?: any) => void;
  waitForNotification: (method: string, predicate: (params: any) => boolean, timeoutMs?: number) => Promise<{ method: string; params: any }>;
  /**
   * Rejects if the app-server exits or errors.
   * Useful for short-circuiting long waits.
   */
  exitPromise: Promise<never>;
  close: () => void;
};

export function spawnCodexAppServerRpc(args?: {
  signal?: AbortSignal;
  /**
   * Handle server-initiated requests (JSON-RPC messages with {id, method}).
   * Use this to respond to approval prompts, token refresh requests, etc.
   */
  onServerRequest?: (req: {
    id: number;
    method: string;
    params: any;
    respondResult: (result: any) => void;
    respondError: (message: string, code?: number) => void;
  }) => void;
  /**
   * Observe notifications (JSON-RPC messages with {method} and no id).
   * NOTE: waitForNotification is implemented separately and does not require this.
   */
  onNotification?: (msg: { method: string; params: any }) => void;
}): CodexAppServerRpc {
  const proc = spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "inherit"]
  });

  const rl = readline.createInterface({ input: proc.stdout });

  let nextId = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

  const notifyWaiters = new Map<
    string,
    Array<{ predicate: (params: any) => boolean; resolve: (msg: any) => void; reject: (e: any) => void }>
  >();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    rl.close();
    try {
      proc.kill();
    } catch {
      // ignore
    }
  };

  const rejectAll = (err: Error) => {
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(err);
    }
    for (const [method, list] of notifyWaiters) {
      notifyWaiters.set(method, []);
      for (const w of list) w.reject(err);
    }
  };

  const exitPromise = new Promise<never>((_, reject) => {
    proc.once("error", (e) => {
      reject(e);
    });
    proc.once("exit", (code, sig) => {
      if (closed) return;
      reject(new Error(`Codex app-server exited (code=${code ?? "?"}, signal=${sig ?? "?"})`));
    });
  });

  const sendRaw = (msg: any) => {
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
  };

  const request = async (method: string, params?: any): Promise<any> => {
    const id = nextId++;
    sendRaw({ method, id, params: params ?? {} });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const notify = (method: string, params?: any) => {
    sendRaw({ method, params: params ?? {} });
  };

  const respondResult = (id: number, result: any) => {
    sendRaw({ id, result });
  };

  const respondError = (id: number, message: string, code = -32000) => {
    sendRaw({ id, error: { code, message } });
  };

  const waitForNotification = (method: string, predicate: (params: any) => boolean, timeoutMs = 20_000) => {
    return new Promise<{ method: string; params: any }>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: (msg: any) => {
          cleanup();
          resolve(msg);
        },
        reject: (e: any) => {
          cleanup();
          reject(e);
        }
      };

      const cleanup = () => {
        clearTimeout(to);
        const cur = notifyWaiters.get(method) ?? [];
        notifyWaiters.set(
          method,
          cur.filter((w) => w !== waiter)
        );
      };

      const to = setTimeout(() => {
        waiter.reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);

      const list = notifyWaiters.get(method) ?? [];
      list.push(waiter);
      notifyWaiters.set(method, list);
    });
  };

  rl.on("line", (line) => {
    const msg = safeJsonParse(line) as JsonRpcMessage | null;
    if (!msg) return;

    // Response to a client request.
    if (typeof (msg as any).id === "number" && ("result" in (msg as any) || "error" in (msg as any))) {
      const id = (msg as any).id as number;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);

      if ((msg as any).error) {
        const err = (msg as any).error;
        p.reject(new Error(err?.message ?? `Codex RPC error (id=${id})`));
      } else {
        p.resolve((msg as any).result);
      }
      return;
    }

    // Server-initiated request (requires client response).
    if (typeof (msg as any).id === "number" && typeof (msg as any).method === "string") {
      const id = (msg as any).id as number;
      const method = (msg as any).method as string;
      const params = (msg as any).params;

      const onServerRequest = args?.onServerRequest;
      if (onServerRequest) {
        onServerRequest({
          id,
          method,
          params,
          respondResult: (result) => respondResult(id, result),
          respondError: (message, code) => respondError(id, message, code)
        });
        return;
      }

      respondError(id, `Unsupported server request: ${method}`);
      return;
    }

    // Notification.
    if (typeof (msg as any).method === "string" && (msg as any).id === undefined) {
      const method = (msg as any).method as string;
      const params = (msg as any).params;

      // Notify waiters first.
      const waiters = notifyWaiters.get(method);
      if (waiters?.length) {
        const remaining: typeof waiters = [];
        for (const w of waiters) {
          try {
            if (w.predicate(params)) {
              w.resolve({ method, params });
            } else {
              remaining.push(w);
            }
          } catch (e) {
            w.reject(e);
          }
        }
        notifyWaiters.set(method, remaining);
      }

      args?.onNotification?.({ method, params });
      return;
    }
  });

  if (args?.signal) {
    if (args.signal.aborted) {
      close();
    } else {
      args.signal.addEventListener(
        "abort",
        () => {
          close();
        },
        { once: true }
      );
    }
  }

  // If the process exits early, reject everything.
  void exitPromise.catch((e) => {
    if (closed) return;
    rejectAll(e instanceof Error ? e : new Error(String(e ?? "Codex app-server error")));
    close();
  });

  return { proc, request, notify, waitForNotification, exitPromise, close };
}
