import http from "node:http";
import { loadEcliaConfig, preflightListen, writeLocalEcliaConfig, type EcliaConfigPatch } from "@eclia/config";

type ChatReqBody = {
  sessionId?: string;
  model?: string;
  userText?: string;
};

type ConfigReqBody = {
  console?: { host?: string; port?: number };
  api?: { port?: number };
};

function isValidPort(n: unknown): n is number {
  if (typeof n !== "number" || !Number.isFinite(n)) return false;
  const i = Math.trunc(n);
  return i >= 1 && i <= 65535;
}

function cleanHost(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += String(chunk)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function corsHeaders(extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    ...extra
  };
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, corsHeaders({ "Content-Type": "application/json" }));
  res.end(JSON.stringify(body));
}

function sseHeaders() {
  return corsHeaders({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
}

function send(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}
`);
  res.write(`data: ${JSON.stringify(data)}

`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const { config } = loadEcliaConfig(process.cwd());
const PORT = Number(process.env.PORT ?? config.api.port);

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // Dev config read/write (write to eclia.config.local.toml).
  if (url === "/api/config" && req.method === "GET") {
    const { config: live, configPath, localPath } = loadEcliaConfig(process.cwd());
    json(res, 200, {
      ok: true,
      config: live,
      paths: { base: configPath, local: localPath },
      restartRequired: true
    });
    return;
  }

  if (url === "/api/config" && req.method === "PUT") {
    const body = (await readJson(req)) as ConfigReqBody;

    const patch: EcliaConfigPatch = {};

    // Validate + normalize console host/port.
    if (body.console?.host !== undefined) {
      const h = cleanHost(body.console.host);
      if (!h) {
        json(res, 400, { ok: false, error: "invalid_host", hint: "Host must be a non-empty string." });
        return;
      }
      patch.console = { ...(patch.console ?? {}), host: h };
    }

    if (body.console?.port !== undefined) {
      const p = Number(body.console.port);
      if (!isValidPort(p)) {
        json(res, 400, { ok: false, error: "invalid_port", hint: "Port must be an integer in 1–65535." });
        return;
      }
      patch.console = { ...(patch.console ?? {}), port: Math.trunc(p) };
    }

    if (body.api?.port !== undefined) {
      const p = Number(body.api.port);
      if (!isValidPort(p)) {
        json(res, 400, { ok: false, error: "invalid_api_port", hint: "API port must be an integer in 1–65535." });
        return;
      }
      patch.api = { ...(patch.api ?? {}), port: Math.trunc(p) };
    }

    if (!patch.console && !patch.api) {
      json(res, 400, { ok: false, error: "empty_patch", hint: "Nothing to update." });
      return;
    }

    // Preflight: if console host/port changed, ensure we can bind.
    try {
      const { config: current } = loadEcliaConfig(process.cwd());

      const changingConsole = !!patch.console;
      const wantHost = patch.console?.host ?? current.console.host;
      const wantPort = patch.console?.port ?? current.console.port;

      const changed = changingConsole && (wantHost !== current.console.host || wantPort !== current.console.port);

      if (changed) {
        const probe = await preflightListen(wantHost, wantPort);
        if (!probe.ok) {
          json(res, 400, {
            ok: false,
            error: "console_listen_failed",
            hint: probe.hint
          });
          return;
        }
      }
    } catch {
      // If probing fails unexpectedly, do not block saving.
    }

    try {
      const out = writeLocalEcliaConfig(patch, process.cwd());
      json(res, 200, { ok: true, config: out.config, restartRequired: true });
    } catch {
      json(res, 500, { ok: false, error: "write_failed", hint: "Failed to write eclia.config.local.toml." });
    }
    return;
  }

  // Chat streaming (demo only).
  if (url === "/api/chat" && req.method === "POST") {
    const body = (await readJson(req)) as ChatReqBody;
    const sessionId = String(body.sessionId ?? "");
    const model = String(body.model ?? "");
    const userText = String(body.userText ?? "");

    res.writeHead(200, sseHeaders());

    send(res, "meta", { at: Date.now(), sessionId, model });

    // Simulate chunked output (replace this with a real LLM/router/tool runtime).
    const chunks = [
      `Received: ${userText.slice(0, 120)}${userText.length > 120 ? "..." : ""}`,
      "This is a demo SSE server: response is text/event-stream, messages are sent as event/data blocks.",
      "In a real system, you can also stream tool_call / tool_result / citations / retrieval as events."
    ];

    for (const c of chunks) {
      await sleep(260);
      send(res, "delta", { at: Date.now(), text: c + "\n\n" });
    }

    await sleep(180);
    send(res, "tool_call", { at: Date.now(), name: "echo", args: { upper: userText.toUpperCase() } });
    await sleep(240);
    send(res, "tool_result", { at: Date.now(), name: "echo", ok: true, result: { ok: true } });

    await sleep(120);
    send(res, "done", { at: Date.now() });
    res.end();

    req.on("close", () => {
      // In real streaming generation, you'd cancel the model inference here.
    });

    return;
  }

  json(res, 404, { error: "not_found" });
});

server.listen(PORT, () => {
  console.log(`[sse] listening on http://localhost:${PORT}`);
  console.log(`[sse] POST http://localhost:${PORT}/api/chat`);
  console.log(`[sse] GET/PUT http://localhost:${PORT}/api/config`);
});
