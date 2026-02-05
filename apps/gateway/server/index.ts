import http from "node:http";
import { loadEcliaConfig, writeLocalEcliaConfig, preflightListen, joinUrl, resolveUpstreamModel, type EcliaConfigPatch } from "@eclia/config";

type ChatReqBody = {
  sessionId?: string;
  model?: string; // UI route key OR a real upstream model id
  userText?: string;
  messages?: Array<{ role: "system" | "user" | "assistant" | "tool"; content: any }>;
};

type ConfigReqBody = {
  console?: { host?: string; port?: number };
  api?: { port?: number };
  inference?: {
    openai_compat?: {
      base_url?: string;
      model?: string;
      api_key?: string;
      auth_header?: string;
    };
  };
};

function json(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive"
  };
}

function send(res: http.ServerResponse, event: string, data: any) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify({ at: Date.now(), ...data })}\n\n`);
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Parse upstream SSE "data:" blocks. This is intentionally minimal.
 */
function parseSSE(input: string): { blocks: Array<{ data: string }>; rest: string } {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";

  const blocks: Array<{ data: string }> = [];
  for (const part of parts) {
    const lines = part.split("\n").filter(Boolean);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
    }
    blocks.push({ data: dataLines.join("\n") });
  }
  return { blocks, rest };
}

function safeText(v: any): string {
  return typeof v === "string" ? v : "";
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = (await readJson(req)) as ChatReqBody;

  const sessionId = String(body.sessionId ?? "");
  const routeModel = String(body.model ?? "");
  const userText = String(body.userText ?? "");

  const { config } = loadEcliaConfig(process.cwd());

  res.writeHead(200, sseHeaders());
  send(res, "meta", { sessionId, model: routeModel });

  // Build OpenAI-compatible request.
  const provider = config.inference.provider;
  if (provider !== "openai_compat") {
    send(res, "error", { message: `Unsupported provider: ${provider}` });
    send(res, "done", {});
    res.end();
    return;
  }

  const baseUrl = config.inference.openai_compat.base_url;
  const apiKey = config.inference.openai_compat.api_key ?? "";
  const authHeader = config.inference.openai_compat.auth_header ?? "Authorization";
  const upstreamModel = resolveUpstreamModel(routeModel, config);

  if (!apiKey.trim()) {
    send(res, "error", {
      message:
        "Missing API key. Set inference.openai_compat.api_key in eclia.config.local.toml (or add it in Settings)."
    });
    send(res, "done", {});
    res.end();
    return;
  }

  const messages =
    Array.isArray(body.messages) && body.messages.length
      ? body.messages
      : [{ role: "user", content: userText }];

  const url = joinUrl(baseUrl, "/chat/completions");

  // Observability: log only safe metadata (never log api keys).
  console.log(`[gateway] POST /api/chat  session=${sessionId || "-"} model=${upstreamModel}`);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        [authHeader]: authHeader.toLowerCase() === "authorization" ? `Bearer ${apiKey}` : apiKey
      },
      body: JSON.stringify({
        model: upstreamModel,
        stream: true,
        messages
      })
    });
  } catch (e: any) {
    send(res, "error", { message: `Upstream request failed: ${String(e?.message ?? e)}` });
    send(res, "done", {});
    res.end();
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    send(res, "error", {
      message: `Upstream error: ${upstream.status} ${upstream.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`
    });
    send(res, "done", {});
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { blocks, rest } = parseSSE(buffer);
      buffer = rest;

      for (const b of blocks) {
        const data = b.data.trim();
        if (!data) continue;

        if (data === "[DONE]") {
          send(res, "done", {});
          res.end();
          return;
        }

        let parsed: any = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          // Some providers may send non-JSON lines; ignore.
          continue;
        }

        const delta = parsed?.choices?.[0]?.delta;
        const content = safeText(delta?.content);
        if (content) send(res, "delta", { text: content });

        // Tool calls are forwarded as events (execution comes later).
        const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : null;
        if (toolCalls && toolCalls.length) {
          for (const tc of toolCalls) {
            const name = safeText(tc?.function?.name);
            const argsText = safeText(tc?.function?.arguments);
            if (name) send(res, "tool_call", { name, args: { raw: argsText } });
          }
        }

        const finishReason = parsed?.choices?.[0]?.finish_reason;
        if (finishReason === "stop") {
          send(res, "done", {});
          res.end();
          return;
        }
      }
    }
  } catch (e: any) {
    send(res, "error", { message: `Stream error: ${String(e?.message ?? e)}` });
  } finally {
    if (!res.writableEnded) {
      send(res, "done", {});
      res.end();
    }
  }
}

async function handleConfig(req: http.IncomingMessage, res: http.ServerResponse) {
  const { config, rootDir } = loadEcliaConfig(process.cwd());

  if (req.method === "GET") {
    // Do NOT return secrets.
    return json(res, 200, {
      ok: true,
      config: {
        console: config.console,
        api: config.api,
        inference: {
          provider: config.inference.provider,
          openai_compat: {
            base_url: config.inference.openai_compat.base_url,
            model: config.inference.openai_compat.model,
            api_key_configured: Boolean(config.inference.openai_compat.api_key && config.inference.openai_compat.api_key.trim())
          }
        }
      }
    });
  }

  if (req.method === "PUT") {
    const body = (await readJson(req)) as ConfigReqBody;

    const patch: EcliaConfigPatch = {};
    if (body.console) patch.console = body.console;
    if (body.api) patch.api = body.api;
    if (body.inference?.openai_compat) patch.inference = { openai_compat: body.inference.openai_compat };

    // Optional: if user sends api_key="", treat as "do not change".
    if (patch.inference?.openai_compat && typeof patch.inference.openai_compat.api_key === "string") {
      if (!patch.inference.openai_compat.api_key.trim()) delete patch.inference.openai_compat.api_key;
    }

    // Preflight host/port bind if console is being changed (avoid writing broken config).
    if (patch.console?.host || patch.console?.port) {
      const host = String(patch.console?.host ?? config.console.host);
      const port = Number(patch.console?.port ?? config.console.port);
      const ok = await preflightListen(host, port);
      if (!ok.ok) return json(res, 400, ok);
    }

    try {
      writeLocalEcliaConfig(patch, rootDir);
      return json(res, 200, { ok: true, restartRequired: true });
    } catch {
      return json(res, 500, { ok: false, error: "write_failed", hint: "Failed to write eclia.config.local.toml." });
    }
  }

  json(res, 405, { ok: false, error: "method_not_allowed" });
}

async function main() {
  const { config } = loadEcliaConfig(process.cwd());
  const port = config.api.port;

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";

    // Basic CORS for direct access (Vite proxy usually makes this unnecessary).
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url === "/api/health" && req.method === "GET") return json(res, 200, { ok: true });

    if (url === "/api/config") return await handleConfig(req, res);

    if (url === "/api/chat" && req.method === "POST") return await handleChat(req, res);

    json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[gateway] listening on http://localhost:${port}`);
    console.log(`[gateway] POST http://localhost:${port}/api/chat`);
    console.log(`[gateway] GET/PUT http://localhost:${port}/api/config`);
  });
}

main().catch((e) => {
  console.error("[gateway] fatal:", e);
  process.exit(1);
});
