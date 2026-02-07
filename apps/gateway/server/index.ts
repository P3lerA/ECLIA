import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { loadEcliaConfig, writeLocalEcliaConfig, preflightListen, joinUrl, resolveUpstreamModel, type EcliaConfigPatch } from "@eclia/config";
import { SessionStore } from "./sessionStore";
import type { SessionDetail, SessionEventV1, StoredMessage } from "./sessionTypes";
import { buildTruncatedContext } from "./context";
import { blocksFromAssistantRaw, inferVendorFromBaseUrl, textBlock } from "./normalize";

type ChatReqBody = {
  sessionId?: string;
  model?: string; // UI route key OR a real upstream model id
  userText?: string;

  /**
   * Client-side runtime preference (not stored in TOML).
   * Token counting is vendor-specific; we use a conservative estimator.
   */
  contextTokenLimit?: number;

  /**
   * Legacy/compat: allow callers to send explicit messages (used by mock transport).
   * If provided, the gateway will still persist the session, but context will be taken from storage.
   */
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

function safeInt(v: any, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function safeDecodeSegment(seg: string): string | null {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

function deriveTitle(userText: string): string {
  const s = userText.replace(/\s+/g, " ").trim();
  if (!s) return "New session";
  const max = 64;
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

type ToolCallAccum = { callId: string; name: string; argsRaw: string };

function mergeToolCallDelta(
  acc: Map<string, ToolCallAccum>,
  tc: any
): ToolCallAccum | null {
  if (!tc || typeof tc !== "object") return null;

  // Some providers send { index }, some send { id }.
  const key = safeText(tc.id) || String(tc.index ?? "");
  if (!key) return null;

  const prev = acc.get(key) ?? { callId: key, name: "", argsRaw: "" };

  const fn = tc.function ?? {};
  const name = safeText(fn.name) || prev.name;
  const argsDelta = safeText(fn.arguments);

  const next: ToolCallAccum = {
    callId: prev.callId,
    name,
    argsRaw: prev.argsRaw + argsDelta
  };

  acc.set(key, next);
  return next;
}

async function handleSessions(req: http.IncomingMessage, res: http.ServerResponse, store: SessionStore) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const pathname = u.pathname;

  // /api/sessions
  if (pathname === "/api/sessions" && req.method === "GET") {
    const limit = safeInt(u.searchParams.get("limit"), 200);
    const sessions = await store.listSessions(limit);
    return json(res, 200, { ok: true, sessions });
  }

  if (pathname === "/api/sessions" && req.method === "POST") {
    const body = (await readJson(req)) as any;
    const title = typeof body?.title === "string" ? body.title : undefined;
    const id = typeof body?.id === "string" ? body.id : undefined;

    try {
      let meta = id
        ? await store.ensureSession(id, {
            v: 1,
            id,
            title: title && title.trim() ? title.trim() : "New session",
            createdAt: Date.now(),
            updatedAt: Date.now()
          })
        : await store.createSession(title);

      // If caller provided a title and the existing session is still default, update it.
      if (id && title && title.trim() && meta.title === "New session") {
        meta = await store.updateMeta(id, { title: title.trim(), updatedAt: Date.now() });
      }

      return json(res, 200, { ok: true, session: meta });
    } catch {
      return json(res, 400, { ok: false, error: "invalid_session_id" });
    }
  }

  // /api/sessions/:id
  const m1 = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (m1 && req.method === "GET") {
    const id = safeDecodeSegment(m1[1]);
    if (!id) return json(res, 400, { ok: false, error: "invalid_session_id" });

    if (!store.isValidSessionId(id)) return json(res, 400, { ok: false, error: "invalid_session_id" });

    const detail = await store.readSession(id, { includeTools: true });
    if (!detail) return json(res, 404, { ok: false, error: "not_found" });
    return json(res, 200, { ok: true, session: detail.meta, messages: detail.messages });
  }

  // /api/sessions/:id/reset
  const m2 = pathname.match(/^\/api\/sessions\/([^/]+)\/reset$/);
  if (m2 && req.method === "POST") {
    const id = safeDecodeSegment(m2[1]);
    if (!id) return json(res, 400, { ok: false, error: "invalid_session_id" });

    if (!store.isValidSessionId(id)) return json(res, 400, { ok: false, error: "invalid_session_id" });
    try {
      const meta = await store.resetSession(id);
      return json(res, 200, { ok: true, session: meta });
    } catch {
      return json(res, 400, { ok: false, error: "invalid_session_id" });
    }
  }

  return json(res, 404, { ok: false, error: "not_found" });
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse, store: SessionStore) {
  const body = (await readJson(req)) as ChatReqBody;

  const sessionId = String(body.sessionId ?? "").trim();
  const routeModel = String(body.model ?? "").trim();
  const userText = String(body.userText ?? "");

  if (!sessionId) {
    return json(res, 400, { ok: false, error: "missing_session", hint: "sessionId is required" });
  }
  if (!store.isValidSessionId(sessionId)) {
    return json(res, 400, { ok: false, error: "invalid_session_id" });
  }
  if (!userText.trim()) {
    return json(res, 400, { ok: false, error: "empty_message" });
  }

  const { config, rootDir } = loadEcliaConfig(process.cwd());
  const provider = config.inference.provider;

  // Ensure store is initialized and session exists.
  await store.init();
  let prior: SessionDetail;
  try {
    prior = (await store.readSession(sessionId)) ?? { meta: await store.ensureSession(sessionId), messages: [] };
  } catch {
    return json(res, 400, { ok: false, error: "invalid_session_id" });
  }

  // If this is a brand new session, set a title from the first user message.
  if (prior.messages.length === 0 && (prior.meta.title === "New session" || !prior.meta.title.trim())) {
    await store.updateMeta(sessionId, { title: deriveTitle(userText) });
  }

  // Persist the user message first (so the session survives even if upstream fails).
  const userMsg: StoredMessage = {
    id: crypto.randomUUID(),
    role: "user",
    createdAt: Date.now(),
    raw: userText,
    blocks: [textBlock(userText, { adapter: "client" })]
  };

  const userEv: SessionEventV1 = { v: 1, id: crypto.randomUUID(), ts: userMsg.createdAt, type: "message", message: userMsg };
  await store.appendEvent(sessionId, userEv);

  // Build OpenAI-compatible request.
  if (provider !== "openai_compat") {
    res.writeHead(200, sseHeaders());
    send(res, "meta", { sessionId, model: routeModel });
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
    res.writeHead(200, sseHeaders());
    send(res, "meta", { sessionId, model: routeModel });
    send(res, "error", {
      message:
        "Missing API key. Set inference.openai_compat.api_key in eclia.config.local.toml (or add it in Settings)."
    });
    send(res, "done", {});
    res.end();
    return;
  }

  const tokenLimit = safeInt(body.contextTokenLimit, 20000);
  const history = [...prior.messages, userMsg];

  const { messages: contextMessages, usedTokens, dropped } = buildTruncatedContext(history, tokenLimit);

  res.writeHead(200, sseHeaders());
  send(res, "meta", { sessionId, model: routeModel, usedTokens, dropped });

  const url = joinUrl(baseUrl, "/chat/completions");

  console.log(`[gateway] POST /api/chat  session=${sessionId} model=${upstreamModel} ctx≈${usedTokens} dropped=${dropped}`);

  const upstreamAbort = new AbortController();
  req.on("close", () => upstreamAbort.abort());

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
        messages: contextMessages
      }),
      signal: upstreamAbort.signal
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

  let assistantText = "";
  const toolCalls = new Map<string, ToolCallAccum>();
  const emittedToolCalls = new Set<string>();

  const origin = {
    adapter: "openai_compat",
    vendor: inferVendorFromBaseUrl(baseUrl),
    baseUrl,
    model: upstreamModel
  };

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
          break;
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

        if (content) {
          assistantText += content;
          send(res, "delta", { text: content });
        }

        const tcList = Array.isArray(delta?.tool_calls) ? delta.tool_calls : null;
        if (tcList && tcList.length) {
          for (const tc of tcList) {
            const merged = mergeToolCallDelta(toolCalls, tc);
            if (!merged) continue;
            // Emit tool_call once per call (UI currently treats this as a discrete block).
            if (merged.name && !emittedToolCalls.has(merged.callId)) {
              emittedToolCalls.add(merged.callId);
              send(res, "tool_call", { name: merged.name, args: { raw: merged.argsRaw } });
            }
          }
        }

        const finishReason = parsed?.choices?.[0]?.finish_reason;
        if (finishReason === "stop") {
          send(res, "done", {});
          res.end();
          break;
        }
      }
      if (res.writableEnded) break;
    }
  } catch (e: any) {
    send(res, "error", { message: `Stream error: ${String(e?.message ?? e)}` });
  } finally {
    if (!res.writableEnded) {
      send(res, "done", {});
      res.end();
    }
  }

  // Persist assistant output (best-effort).
  // Even if the client aborted early, keep what we received.
  try {
    if (!assistantText && toolCalls.size === 0) {
      await store.updateMeta(sessionId, { updatedAt: Date.now(), lastModel: routeModel || upstreamModel });
      return;
    }

    const assistantMsg: StoredMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      createdAt: Date.now(),
      raw: assistantText,
      blocks: blocksFromAssistantRaw(assistantText, origin)
    };

    const ev: SessionEventV1 = { v: 1, id: crypto.randomUUID(), ts: assistantMsg.createdAt, type: "message", message: assistantMsg };
    await store.appendEvent(sessionId, ev);

    for (const call of toolCalls.values()) {
      if (!call.name) continue;
      const tev: SessionEventV1 = {
        v: 1,
        id: crypto.randomUUID(),
        ts: Date.now(),
        type: "tool_call",
        call: { callId: call.callId, name: call.name, argsRaw: call.argsRaw }
      };
      await store.appendEvent(sessionId, tev);
    }

    await store.updateMeta(sessionId, { updatedAt: Date.now(), lastModel: routeModel || upstreamModel });
  } catch (e) {
    console.warn("[gateway] failed to persist assistant message:", e);
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
  const { config, rootDir } = loadEcliaConfig(process.cwd());
  const port = config.api.port;

  // Session store lives under <repo>/.eclia by default.
  const dataDir = path.join(rootDir, ".eclia");
  const store = new SessionStore(dataDir);
  await store.init();

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

    const u = new URL(url, "http://localhost");
    const pathname = u.pathname;

    if (pathname === "/api/health" && req.method === "GET") return json(res, 200, { ok: true });

    if (pathname === "/api/config") return await handleConfig(req, res);

    if (pathname.startsWith("/api/sessions")) return await handleSessions(req, res, store);

    if (pathname === "/api/chat" && req.method === "POST") return await handleChat(req, res, store);

    json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[gateway] listening on http://localhost:${port}`);
    console.log(`[gateway] POST http://localhost:${port}/api/chat`);
    console.log(`[gateway] GET/PUT http://localhost:${port}/api/config`);
    console.log(`[gateway] GET/POST http://localhost:${port}/api/sessions`);
  });
}

main().catch((e) => {
  console.error("[gateway] fatal:", e);
  process.exit(1);
});
