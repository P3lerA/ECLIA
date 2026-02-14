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
  const codexExe = (process.env.ECLIA_CODEX_EXECUTABLE ?? "codex").trim() || "codex";

  // Collect recent STDERR lines to make failures actionable in the UI.
  const stderrRing: string[] = [];
  const pushStderr = (line: string) => {
    const s = String(line ?? "").trimEnd();
    if (!s) return;
    stderrRing.push(s);
    // Keep the tail small to avoid leaking too much output / memory.
    if (stderrRing.length > 50) stderrRing.splice(0, stderrRing.length - 50);
  };

  // Also collect recent NON-JSON stdout lines. A real app-server should emit only JSONL.
  // If we capture human-readable output here (usage/help, prompts, logs), it usually means
  // the wrong `codex` binary was invoked or the CLI is too old for app-server.
  const stdoutGarbageRing: string[] = [];
  const pushStdoutGarbage = (line: string) => {
    const s = String(line ?? "").trimEnd();
    if (!s) return;
    stdoutGarbageRing.push(s);
    if (stdoutGarbageRing.length > 50) stdoutGarbageRing.splice(0, stdoutGarbageRing.length - 50);
  };

  // Prefer explicit stdio transport so we don't get surprised by defaults changing.
  const proc = spawn(codexExe, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  const rl = readline.createInterface({ input: proc.stdout });
  const rlErr = readline.createInterface({ input: proc.stderr });
  const forwardStderr = process.env.ECLIA_CODEX_FORWARD_STDERR !== "0";
  rlErr.on("line", (line) => {
    pushStderr(line);
    if (forwardStderr) {
      try {
        process.stderr.write(`[codex] ${String(line ?? "")}\n`);
      } catch {
        // ignore
      }
    }
  });

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
    rlErr.close();
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
      const tail = stderrRing.length ? `\nLast stderr:\n${stderrRing.join("\n")}` : "";
      const stdoutTail = stdoutGarbageRing.length ? `\nLast stdout (non-JSON):\n${stdoutGarbageRing.join("\n")}` : "";
      // If we exited with code=0, it's often a sign the wrong `codex` executable was invoked
      // (or an older CLI that doesn't support app-server), because a real app-server session
      // should stay alive awaiting JSON-RPC over stdio.
      const maybeHint =
        code === 0
          ?
              "\nHint: `codex app-server` exited immediately with code 0. This commonly happens when:\n" +
              "  • The `codex` on PATH is not OpenAI's Codex CLI (or it's an older version without app-server).\n" +
              "  • You're launching through a wrapper that fails before starting the real binary.\n" +
              "Try running `codex --version` and `codex app-server --help` in the same environment as the gateway."
          : "";
      reject(
        new Error(`Codex app-server exited (code=${code ?? "?"}, signal=${sig ?? "?"})${tail}${stdoutTail}${maybeHint}`)
      );
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
    if (!msg) {
      pushStdoutGarbage(line);
      return;
    }

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
