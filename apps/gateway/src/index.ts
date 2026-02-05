import http from "node:http";
import net from "node:net";
import { loadEcliaConfig, writeLocalEcliaConfig, type EcliaConfigPatch } from "./ecliaConfig";
import { createSSE } from "./sse";
import { streamOpenAICompatChat } from "./inference/openaiCompat";

type ChatReqBody = {
  sessionId: string;
  model: string;
  userText: string;
};

type ConfigReqBody = {
  console?: { host?: string; port?: number };
  api?: { port?: number };
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function setCors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

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

function hintForListenError(code: string | undefined): string {
  switch (code) {
    case "EACCES":
      return "Permission denied. On some systems, this port may be reserved by the OS. Try a higher port (e.g. 5173, 3000, 8080).";
    case "EADDRINUSE":
      return "Port is already in use. Pick another port or stop the process currently using it.";
    case "EADDRNOTAVAIL":
      return "Host/IP is not available on this machine.";
    default:
      return "Unable to bind to the requested host/port.";
  }
}

async function probeTcpListen(
  host: string,
  port: number
): Promise<{ ok: true } | { ok: false; code?: string; message: string; hint: string }> {
  return await new Promise((resolve) => {
    const srv = net.createServer();

    const onError = (err: any) => {
      const code = typeof err?.code === "string" ? err.code : undefined;
      const message = typeof err?.message === "string" ? err.message : "listen failed";
      resolve({ ok: false, code, message, hint: hintForListenError(code) });
    };

    srv.once("error", onError);
    srv.listen({ host, port }, () => {
      srv.removeListener("error", onError);
      srv.close(() => resolve({ ok: true }));
    });
  });
}

function now() {
  return Date.now();
}

const { config } = loadEcliaConfig(process.cwd());

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  // Health
  if (req.method === "GET" && path === "/api/health") {
    json(res, 200, { ok: true, at: now() });
    return;
  }

  // Config (used by web-console Settings)
  if (path === "/api/config") {
    if (req.method === "GET") {
      const { config: cfg } = loadEcliaConfig(process.cwd());
      json(res, 200, { ok: true, config: { console: cfg.console, api: cfg.api } });
      return;
    }

    if (req.method === "PUT") {
      try {
        const body = (await readJson(req)) as ConfigReqBody;
        const patch: EcliaConfigPatch = {};

        if (body.console) {
          const host = cleanHost(body.console.host);
          const port = body.console.port;
          if (host) {
            patch.console ??= {};
            patch.console.host = host;
          }
          if (isValidPort(port)) {
            patch.console ??= {};
            patch.console.port = Math.trunc(port);
          }
        }

        if (body.api) {
          const port = body.api.port;
          if (isValidPort(port)) {
            patch.api ??= {};
            patch.api.port = Math.trunc(port);
          }
        }

        // Preflight: ensure the dev server can bind to the requested console host/port.
        if (patch.console?.host && typeof patch.console.port === "number") {
          const probe = await probeTcpListen(patch.console.host, patch.console.port);
          if (!probe.ok) {
            json(res, 200, { ok: false, error: probe.message, hint: probe.hint });
            return;
          }
        }

        const { config: nextCfg } = writeLocalEcliaConfig(patch, process.cwd());
        json(res, 200, { ok: true, config: { console: nextCfg.console, api: nextCfg.api }, restartRequired: true });
      } catch (err: any) {
        json(res, 200, { ok: false, error: "Bad request", hint: err?.message });
      }
      return;
    }

    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  // Chat (SSE)
  if (req.method === "POST" && path === "/api/chat") {
    const sse = createSSE(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());

    try {
      const body = (await readJson(req)) as ChatReqBody;
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "unknown";
      const userText = typeof body.userText === "string" ? body.userText : "";
      const requestedModel = typeof body.model === "string" ? body.model.trim() : "";

      const { config: cfg } = loadEcliaConfig(process.cwd());

      if (cfg.inference.provider !== "openai_compat") {
        sse.write("error", {
          type: "error",
          at: now(),
          message: `Unsupported inference provider: ${cfg.inference.provider}`
        });
        sse.write("done", { type: "done", at: now() });
        sse.close();
        return;
      }

      const inf = cfg.inference.openai_compat;

      // UI models are currently route-keys (e.g. "openai-compatible"), not literal provider model ids.
      // Until we add a real router, map known keys to the configured provider model.
      const upstreamModel = (() => {
        if (!requestedModel) return inf.model;
        const knownKeys = new Set(["local/ollama", "openai-compatible", "router/gateway"]);
        if (knownKeys.has(requestedModel)) return inf.model;
        return requestedModel;
      })();

      sse.write("meta", { type: "meta", at: now(), sessionId, model: upstreamModel });


      if (!userText.trim()) {
        sse.write("delta", { type: "delta", at: now(), text: "Please type something." });
        sse.write("done", { type: "done", at: now() });
        sse.close();
        return;
      }

      const messages = [{ role: "user" as const, content: userText }];

      for await (const evt of streamOpenAICompatChat(
        { base_url: inf.base_url, api_key: inf.api_key, model: inf.model },
        { model: upstreamModel, messages, signal: ac.signal }
      )) {
        if (evt.kind === "delta") {
          sse.write("delta", { type: "delta", at: now(), text: evt.text });
        }
      }

      sse.write("done", { type: "done", at: now() });
      sse.close();
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Unknown error";
      sse.write("error", { type: "error", at: now(), message: msg });
      sse.write("done", { type: "done", at: now() });
      sse.close();
    }

    return;
  }

  json(res, 404, { ok: false, error: "Not found" });
});

server.listen(config.api.port, "127.0.0.1", () => {
  console.log(`[gateway] listening on http://localhost:${config.api.port}`);
  console.log(`[gateway] POST ${`http://localhost:${config.api.port}`}/api/chat`);
  console.log(`[gateway] GET/PUT ${`http://localhost:${config.api.port}`}/api/config`);
});
