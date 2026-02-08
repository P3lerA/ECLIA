import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

type JsonRpcId = number | string;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: any;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: any;
  error?: { code: number; message: string; data?: any };
};

export type McpToolDef = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: any;
  outputSchema?: any;
};

export type McpCallToolResult = {
  content: Array<{ type: "text"; text: string; [k: string]: any } | { type: string; [k: string]: any }>;
  isError?: boolean;
  [k: string]: any;
};

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams;
  private label: string;
  private nextId = 1;
  private pending = new Map<
    JsonRpcId,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout | null }
  >();
  private closed = false;

  private constructor(child: ChildProcessWithoutNullStreams, label: string) {
    this.child = child;
    this.label = label;

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.onLine(line));

    child.stderr.on("data", (buf) => {
      // MCP stdio reserves stderr for logs.
      // Keep it visible in gateway logs for diagnosis.
      const s = buf.toString("utf-8");
      if (s.trim()) console.warn(`[${this.label}]`, s.trimEnd());
    });

    const onExit = (why: string) => {
      if (this.closed) return;
      this.closed = true;
      const err = new Error(`MCP toolhost '${this.label}' exited (${why})`);
      for (const [, p] of this.pending) {
        if (p.timer) clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    };

    child.on("exit", (code, signal) => onExit(`code=${code} signal=${signal ?? ""}`));
    child.on("error", (e) => onExit(String(e?.message ?? e)));
  }

  static async spawn(args: {
    command: string;
    argv: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    label?: string;
  }): Promise<McpStdioClient> {
    const child = spawn(args.command, args.argv, {
      cwd: args.cwd,
      env: args.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const client = new McpStdioClient(child, args.label ?? "toolhost");

    // Lifecycle: initialize -> initialized
    const initRes = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ECLIA", title: "ECLIA Gateway", version: "0.1.0" }
    });

    // Basic version negotiation: accept server version if it matches, otherwise keep going.
    // (We control both sides for now, but this keeps the client tolerant.)
    const serverVersion = typeof initRes?.protocolVersion === "string" ? initRes.protocolVersion : "unknown";
    if (serverVersion !== "2025-06-18") {
      console.warn(`[gateway] MCP toolhost protocolVersion=${serverVersion} (client expects 2025-06-18)`);
    }

    client.notify("notifications/initialized", undefined);

    return client;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    try {
      this.child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  async listTools(): Promise<McpToolDef[]> {
    const r = await this.request("tools/list", {});
    const tools = Array.isArray(r?.tools) ? r.tools : [];
    return tools.filter((t: any) => t && typeof t.name === "string");
  }

  async callTool(name: string, argumentsObj: any, opts?: { timeoutMs?: number }): Promise<McpCallToolResult> {
    const r = await this.request(
      "tools/call",
      {
        name,
        arguments: argumentsObj ?? {}
      },
      opts?.timeoutMs
    );
    return (r ?? {}) as McpCallToolResult;
  }

  private onLine(line: string) {
    const s = String(line ?? "").trim();
    if (!s) return;

    let msg: JsonRpcResponse | JsonRpcNotification | JsonRpcRequest | null = null;
    try {
      msg = JSON.parse(s);
    } catch {
      console.warn("[gateway] MCP: bad JSON from toolhost:", s.slice(0, 200));
      return;
    }

    // Response
    if (msg && typeof (msg as any).id !== "undefined" && (msg as any).jsonrpc === "2.0" && !(msg as any).method) {
      const id = (msg as any).id as JsonRpcId;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (p.timer) clearTimeout(p.timer);

      const err = (msg as any).error;
      if (err) {
        p.reject(new Error(`MCP error ${err.code}: ${err.message}`));
      } else {
        p.resolve((msg as any).result);
      }
      return;
    }

    // Notification / Request from server: currently ignored.
    // We don't implement server->client requests yet.
  }

  private send(obj: JsonRpcRequest | JsonRpcNotification) {
    if (this.closed) throw new Error("MCP client is closed");
    // Per stdio transport, messages are newline-delimited and MUST NOT contain embedded newlines.
    // JSON.stringify without spacing ensures a single-line payload.
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  private notify(method: string, params?: any) {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method };
    if (typeof params !== "undefined") msg.params = params;
    this.send(msg);
  }

  private request(method: string, params?: any, timeoutMs?: number): Promise<any> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method };
    if (typeof params !== "undefined") msg.params = params;

    const ms = Math.max(1_000, Math.min(60 * 60_000, Math.trunc(timeoutMs ?? 5 * 60_000)));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout after ${ms}ms: ${method}`));
      }, ms);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.send(msg);
      } catch (e: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(String(e?.message ?? e)));
      }
    });
  }
}
