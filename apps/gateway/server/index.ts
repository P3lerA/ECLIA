import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { loadEcliaConfig, writeLocalEcliaConfig, preflightListen, joinUrl, resolveUpstreamModel, type EcliaConfigPatch } from "@eclia/config";
import { SessionStore } from "./sessionStore";
import type { SessionDetail, SessionEventV1, StoredMessage } from "./sessionTypes";
import { buildTruncatedContext } from "./context";
import { blocksFromAssistantRaw, inferVendorFromBaseUrl, textBlock } from "./normalize";
import { ToolApprovalHub, type ToolApprovalDecision } from "./tools/approvalHub";
import { parseExecArgs, runExecTool } from "./tools/execTool";
import { checkExecNeedsApproval, loadExecAllowlist, type ToolAccessMode } from "./tools/policy";
import { EXEC_TOOL_NAME, EXECUTION_TOOL_NAME, TOOL_DEFINITIONS } from "./tools/toolSchemas";

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
   * Tool access mode (client preference).
   * - full: auto-run tools.
   * - safe: auto-run allowlisted exec commands only; otherwise require user approval.
   */
  toolAccessMode?: ToolAccessMode;

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

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
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

type ToolCallAccum = { callId: string; index?: number; name: string; argsRaw: string };

type ToolCallAccState = {
  calls: Map<string, ToolCallAccum>;
  indexToKey: Map<number, string>;
  idToKey: Map<string, string>;
  unindexedKeys: Set<string>;
  nextAnon: number;
};

function createToolCallAccState(): ToolCallAccState {
  return { calls: new Map(), indexToKey: new Map(), idToKey: new Map(), unindexedKeys: new Set(), nextAnon: 0 };
}

function mergePossiblyCumulative(prev: string, nextChunk: string): string {
  if (!nextChunk) return prev;
  if (!prev) return nextChunk;

  // Some OpenAI-compatible providers stream cumulative strings (full value so far) rather than incremental deltas.
  if (nextChunk.length > prev.length && nextChunk.startsWith(prev)) return nextChunk;

  return prev + nextChunk;
}

function safeToolArgsChunk(v: any): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return safeJsonStringify(v);
}

function mergeToolCallDelta(state: ToolCallAccState, tc: any, position: number): ToolCallAccum | null {
  if (!tc || typeof tc !== "object") return null;

  const rawIndex = tc.index;
  const index = typeof rawIndex === "number" && Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : undefined;
  const id = safeText(tc.id);

  let key: string;

  if (index !== undefined) {
    key = state.indexToKey.get(index) || "";
    if (!key && id) key = state.idToKey.get(id) || "";

    // Heuristic: if we previously saw exactly one unindexed tool call, bind it to this index.
    if (!key && !id && state.unindexedKeys.size === 1) {
      const [onlyKey] = state.unindexedKeys;
      key = onlyKey;
    }

    if (!key) key = `i:${index}`;

    state.indexToKey.set(index, key);
    if (id) state.idToKey.set(id, key);
  } else if (id) {
    key = state.idToKey.get(id) || `id:${id}`;
    state.idToKey.set(id, key);
    state.unindexedKeys.add(key);
  } else {
    key = `anon:${state.nextAnon++}:${position}`;
  }

  const prev = state.calls.get(key) ?? {
    callId: id || (index !== undefined ? `call_index_${index}` : key),
    index,
    name: "",
    argsRaw: ""
  };

  const fn = tc.function ?? {};
  const name = safeText(fn.name) || prev.name;
  const argsChunk = safeToolArgsChunk(fn.arguments);

  const next: ToolCallAccum = {
    callId: id || prev.callId,
    index: prev.index ?? index,
    name,
    argsRaw: mergePossiblyCumulative(prev.argsRaw, argsChunk)
  };

  state.calls.set(key, next);
  if (next.index !== undefined) state.unindexedKeys.delete(key);
  if (id) state.idToKey.set(id, key);

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

async function handleToolApprovals(req: http.IncomingMessage, res: http.ServerResponse, approvals: ToolApprovalHub) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });
  const body = (await readJson(req)) as any;

  const approvalId = String(body.approvalId ?? "").trim();
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;
  const decision: ToolApprovalDecision | null = body.decision === "approve" ? "approve" : body.decision === "deny" ? "deny" : null;

  if (!approvalId || !decision) return json(res, 400, { ok: false, error: "bad_request" });

  const r = approvals.decide({ approvalId, sessionId, decision });
  if (r.ok) return json(res, 200, { ok: true });
  if (r.error === "wrong_session") return json(res, 403, { ok: false, error: "wrong_session" });
  return json(res, 404, { ok: false, error: "not_found" });
}

type UpstreamTurnResult = {
  assistantText: string;
  toolCalls: Map<string, ToolCallAccum>;
  finishReason: string | null;
};

async function streamOpenAICompatTurn(args: {
  url: string;
  headers: Record<string, string>;
  model: string;
  messages: any[];
  signal: AbortSignal;
  tools: any[];
  onDelta: (text: string) => void;
}): Promise<UpstreamTurnResult> {
  let upstream: Response;

  upstream = await fetch(args.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      ...args.headers
    },
    body: JSON.stringify({
      model: args.model,
      stream: true,
      tool_choice: "auto",
      tools: args.tools,
      messages: args.messages
    }),
    signal: args.signal
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    throw new Error(
      `Upstream error: ${upstream.status} ${upstream.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let assistantText = "";
  const toolCallsAcc = createToolCallAccState();
  let finishReason: string | null = null;

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
        return { assistantText, toolCalls: toolCallsAcc.calls, finishReason };
      }

      let parsed: any = null;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      const choice = parsed?.choices?.[0];
      const delta = choice?.delta;
      const content = safeText(delta?.content);

      if (content) {
        // Some OpenAI-compatible providers stream cumulative strings (full content so far) rather than incremental deltas.
        // Detect and only emit the new suffix.
        if (assistantText && content.length > assistantText.length && content.startsWith(assistantText)) {
          const newPart = content.slice(assistantText.length);
          assistantText = content;
          if (newPart) args.onDelta(newPart);
        } else {
          assistantText += content;
          args.onDelta(content);
        }
      }

      const tcList = Array.isArray(delta?.tool_calls) ? delta.tool_calls : null;
      if (tcList && tcList.length) {
        for (let i = 0; i < tcList.length; i++) mergeToolCallDelta(toolCallsAcc, tcList[i], i);
      }

      const fr = choice?.finish_reason;
      if (typeof fr === "string" && fr) finishReason = fr;
    }
  }

  return { assistantText, toolCalls: toolCallsAcc.calls, finishReason };
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse, store: SessionStore, approvals: ToolApprovalHub) {
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

  const toolAccessMode: ToolAccessMode = body.toolAccessMode === "safe" ? "safe" : "full";

  const { config, raw, rootDir } = loadEcliaConfig(process.cwd());
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

  const userEv: SessionEventV1 = {
    v: 1,
    id: crypto.randomUUID(),
    ts: userMsg.createdAt,
    type: "message",
    message: userMsg
  };
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

  console.log(`[gateway] POST /api/chat  session=${sessionId} model=${upstreamModel} ctx≈${usedTokens} dropped=${dropped} tools=on mode=${toolAccessMode}`);

  const execAllowlist = loadExecAllowlist(raw);

  const upstreamAbort = new AbortController();
  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
    upstreamAbort.abort();
    approvals.cancelSession(sessionId);
  });

  const origin = {
    adapter: "openai_compat",
    vendor: inferVendorFromBaseUrl(baseUrl),
    baseUrl,
    model: upstreamModel
  };

  const headers: Record<string, string> = {
    [authHeader]: authHeader.toLowerCase() === "authorization" ? `Bearer ${apiKey}` : apiKey
  };

  // We build the upstream transcript progressively so tool results are fed back correctly.
  const upstreamMessages: any[] = [...contextMessages];

  try {
    // Multi-turn tool loop
    while (!clientClosed) {
      const turn = await streamOpenAICompatTurn({
        url,
        headers,
        model: upstreamModel,
        messages: upstreamMessages,
        signal: upstreamAbort.signal,
        tools: TOOL_DEFINITIONS,
        onDelta: (text) => send(res, "delta", { text })
      });

      const assistantText = turn.assistantText;
      const toolCallsMap = turn.toolCalls;

      // Persist assistant message (even if empty; it anchors tool blocks).
      const assistantMsg: StoredMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        createdAt: Date.now(),
        raw: assistantText,
        blocks: blocksFromAssistantRaw(assistantText, origin)
      };
      const assistantEv: SessionEventV1 = {
        v: 1,
        id: crypto.randomUUID(),
        ts: assistantMsg.createdAt,
        type: "message",
        message: assistantMsg
      };
      await store.appendEvent(sessionId, assistantEv);

      // Close the current assistant streaming phase in the UI.
      send(res, "assistant_end", {});

      const toolCalls = Array.from(toolCallsMap.values()).filter((c) => c.name && c.name.trim());
      toolCalls.sort((a, b) => (a.index ?? 999999) - (b.index ?? 999999));

      if (toolCalls.length === 0) {
        // No tool calls: final answer.
        break;
      }

      // Append the assistant tool-call message to the upstream transcript.
      const assistantToolCallMsg = {
        role: "assistant",
        content: assistantText,
        tool_calls: toolCalls.map((c) => ({
          id: c.callId,
          type: "function",
          function: { name: c.name, arguments: c.argsRaw }
        }))
      };
      upstreamMessages.push(assistantToolCallMsg);

      // Emit tool_call blocks (now we have complete args) and persist them.
      const approvalWaiters = new Map<string, { approvalId: string; wait: ReturnType<ToolApprovalHub["create"]>["wait"] }>();
      const parsedArgsByCall = new Map<string, any>();
      const parsedExecArgsByCall = new Map<string, ReturnType<typeof parseExecArgs>>();
      const parseErrorByCall = new Map<string, string | undefined>();

      for (const call of toolCalls) {
        const tev: SessionEventV1 = {
          v: 1,
          id: crypto.randomUUID(),
          ts: Date.now(),
          type: "tool_call",
          call: { callId: call.callId, name: call.name, argsRaw: call.argsRaw }
        };
        await store.appendEvent(sessionId, tev);

        let parsed: any = null;
        let parseError: string | undefined;
        try {
          parsed = call.argsRaw ? JSON.parse(call.argsRaw) : {};
        } catch (e: any) {
          parsed = {};
          parseError = String(e?.message ?? e);
        }
        parsedArgsByCall.set(call.callId, parsed);
        parseErrorByCall.set(call.callId, parseError);

        // For now, only exec/execution exists.
        let approvalInfo: any = null;

        if (call.name === EXEC_TOOL_NAME || call.name === EXECUTION_TOOL_NAME) {
          const execArgs = parseExecArgs(parsed);
          parsedExecArgsByCall.set(call.callId, execArgs);

          const check = checkExecNeedsApproval(execArgs, toolAccessMode, execAllowlist);

          if (check.requireApproval) {
            const { approvalId, wait } = approvals.create({ sessionId, timeoutMs: 5 * 60_000 });
            approvalWaiters.set(call.callId, { approvalId, wait });
            approvalInfo = { required: true, id: approvalId, reason: check.reason };
          } else {
            approvalInfo = { required: false, reason: check.reason, matchedAllowlist: check.matchedAllowlist };
          }
        }

        send(res, "tool_call", {
          callId: call.callId,
          name: call.name,
          args: {
            sessionId,
            raw: call.argsRaw,
            parsed,
            parseError,
            approval: approvalInfo
          }
        });
      }

      // Execute tools sequentially and feed results back into the upstream transcript.
      const toolMessages: any[] = [];
      for (const call of toolCalls) {
        if (clientClosed) break;

        const name = call.name;
        const parsed = parsedArgsByCall.get(call.callId) ?? {};
        const parseError = parseErrorByCall.get(call.callId);
        const execArgs = parsedExecArgsByCall.get(call.callId);

        let ok = false;
        let output: any = null;

        if (name === EXEC_TOOL_NAME || name === EXECUTION_TOOL_NAME) {
          if (parseError) {
            ok = false;
            output = {
              type: "exec_result",
              ok: false,
              error: { code: "bad_arguments_json", message: `Invalid JSON arguments: ${parseError}` },
              argsRaw: call.argsRaw
            };
          } else {
            const check = checkExecNeedsApproval(execArgs ?? {}, toolAccessMode, execAllowlist);
            const waiter = approvalWaiters.get(call.callId);

            if (check.requireApproval) {
              const decision = waiter ? await waiter.wait : { decision: "deny" as const, timedOut: false };
              if (decision.decision !== "approve") {
                ok = false;
                output = {
                  type: "exec_result",
                  ok: false,
                  error: {
                    code: decision.timedOut ? "approval_timeout" : "denied_by_user",
                    message: decision.timedOut ? "Approval timed out" : "User denied execution"
                  },
                  policy: { mode: toolAccessMode, ...check, approvalId: waiter?.approvalId },
                  args: execArgs ?? parsed
                };
              } else {
                const execOut = await runExecTool(parsed, { projectRoot: rootDir, signal: upstreamAbort.signal });
                ok = Boolean(execOut.ok);
                output = {
                  type: "exec_result",
                  ...execOut,
                  policy: { mode: toolAccessMode, ...check, approvalId: waiter?.approvalId, decision: "approve" }
                };
              }
            } else {
              const execOut = await runExecTool(parsed, { projectRoot: rootDir, signal: upstreamAbort.signal });
              ok = Boolean(execOut.ok);
              output = {
                type: "exec_result",
                ...execOut,
                policy: { mode: toolAccessMode, ...check }
              };
            }
          }
        } else {
          ok = false;
          output = { ok: false, error: { code: "unknown_tool", message: `Unknown tool: ${name}` } };
        }

        // Stream to UI
        send(res, "tool_result", { callId: call.callId, name, ok, result: output });

        // Persist
        const rev: SessionEventV1 = {
          v: 1,
          id: crypto.randomUUID(),
          ts: Date.now(),
          type: "tool_result",
          result: { callId: call.callId, name, ok, output }
        };
        await store.appendEvent(sessionId, rev);

        // Feed back to model
        toolMessages.push({ role: "tool", tool_call_id: call.callId, content: safeJsonStringify(output) });
      }

      upstreamMessages.push(...toolMessages);

      // Start a fresh assistant streaming phase (the model's post-tool response).
      send(res, "assistant_start", { messageId: crypto.randomUUID() });
    }

    await store.updateMeta(sessionId, { updatedAt: Date.now(), lastModel: routeModel || upstreamModel });

    if (!res.writableEnded) {
      send(res, "done", {});
      res.end();
    }
  } catch (e: any) {
    if (clientClosed) return;
    if (!res.writableEnded) {
      send(res, "error", { message: String(e?.message ?? e) });
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
  const { config, rootDir } = loadEcliaConfig(process.cwd());
  const port = config.api.port;

  // Session store lives under <repo>/.eclia by default.
  const dataDir = path.join(rootDir, ".eclia");
  const store = new SessionStore(dataDir);
  await store.init();

  // In-memory hub for interactive tool approvals.
  const approvals = new ToolApprovalHub();

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

    if (pathname === "/api/tool-approvals") return await handleToolApprovals(req, res, approvals);

    if (pathname === "/api/chat" && req.method === "POST") return await handleChat(req, res, store, approvals);

    json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[gateway] listening on http://localhost:${port}`);
    console.log(`[gateway] POST http://localhost:${port}/api/chat`);
    console.log(`[gateway] POST http://localhost:${port}/api/tool-approvals`);
    console.log(`[gateway] GET/PUT http://localhost:${port}/api/config`);
    console.log(`[gateway] GET/POST http://localhost:${port}/api/sessions`);
  });
}

main().catch((e) => {
  console.error("[gateway] fatal:", e);
  process.exit(1);
});
