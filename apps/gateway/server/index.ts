import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadEcliaConfig, writeLocalEcliaConfig, preflightListen, joinUrl, resolveUpstreamModel, type EcliaConfigPatch } from "@eclia/config";
import { SessionStore } from "./sessionStore";
import type { SessionDetail, SessionEventV1, StoredMessage } from "./sessionTypes";
import { buildTruncatedContext } from "./context";
import { blocksFromAssistantRaw, inferVendorFromBaseUrl, textBlock } from "./normalize";
import { ToolApprovalHub, type ToolApprovalDecision } from "./tools/approvalHub";
import { parseExecArgs } from "./tools/execTool";
import { artifactRefFromRepoRelPath } from "@eclia/tool-protocol";
import { checkExecNeedsApproval, loadExecAllowlist, type ToolAccessMode } from "./tools/policy";
import { EXEC_TOOL_NAME, EXECUTION_TOOL_NAME } from "./tools/toolSchemas";
import { McpStdioClient, type McpToolDef } from "./mcp/stdioClient";
import { sseHeaders, initSse, send, startSseKeepAlive } from "./sse";
import { withSessionLock } from "./sessionLock";
import { streamOpenAICompatTurn } from "./upstream/openaiCompat";

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
   * Stream mode for SSE responses.
   * - full: stream deltas + tool events (web console).
   * - final: only send the final assistant output (adapters like discord).
   */
  streamMode?: "full" | "final";

  /**
   * Optional session origin metadata.
   * If the session has no origin yet, the gateway will persist it.
   */
  origin?: { kind: string; [k: string]: unknown };

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
  adapters?: {
    discord?: {
      enabled?: boolean;
      app_id?: string; // non-secret (optional; empty means unchanged)
      bot_token?: string; // secret (optional; empty means unchanged)
    };
  };
};

function json(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
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


const MAX_INLINE_TEXT_BYTES = 24_000;
const PREVIEW_TEXT_BYTES = 12_000;
const MAX_SHA256_BYTES = 5_000_000;

type ArtifactRef = {
  kind: "image" | "text" | "json" | "file";
  path: string; // repo-relative path
  uri?: string;
  ref?: string;
  role?: string;
  bytes: number;
  mime?: string;
  sha256?: string;
};

function normalizeRelPath(p: string): string {
  // Ensure a stable path format across platforms (use forward slashes).
  return p.split(path.sep).join("/");
}

function safeFileToken(s: string): string {
  const cleaned = String(s ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  // Keep filenames reasonably short (some platforms have low limits).
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

function sha256Hex(data: Buffer | string, encoding?: BufferEncoding): string {
  const h = crypto.createHash("sha256");
  if (typeof data === "string") h.update(data, encoding ?? "utf8");
  else h.update(data);
  return h.digest("hex");
}

async function writeArtifact(args: {
  rootDir: string;
  artifactsRoot: string;
  relFile: string;
  data: Buffer | string;
  encoding?: BufferEncoding;
}): Promise<{ absPath: string; relPath: string; bytes: number; sha256?: string }> {
  const absPath = path.join(args.artifactsRoot, args.relFile);
  try {
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
  } catch {
    // ignore
  }

  if (typeof args.data === "string") await fsp.writeFile(absPath, args.data, args.encoding ?? "utf8");
  else await fsp.writeFile(absPath, args.data);

  const bytes =
    typeof args.data === "string" ? Buffer.byteLength(args.data, args.encoding ?? "utf8") : args.data.length;

  // Hashing huge strings/buffers is expensive and (for our purposes) not always worth it.
  const sha256 = bytes <= MAX_SHA256_BYTES ? sha256Hex(args.data, args.encoding) : undefined;

  const relPath = normalizeRelPath(path.relative(args.rootDir, absPath));
  return { absPath, relPath, bytes, sha256 };
}

function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) return s;
  return buf.subarray(0, maxBytes).toString("utf8");
}

async function externalizeLargeTextField(args: {
  rootDir: string;
  artifactsRoot: string;
  sessionId: string;
  callId: string;
  output: any;
  field: "stdout" | "stderr";
  artifacts: ArtifactRef[];
}) {
  const v = args.output?.[args.field];
  if (typeof v !== "string" || !v) return;

  const bytes = Buffer.byteLength(v, "utf8");
  if (bytes <= MAX_INLINE_TEXT_BYTES) return;

  const relFile = path.join(args.sessionId, `${safeFileToken(args.callId)}_${args.field}.txt`);
  const w = await writeArtifact({
    rootDir: args.rootDir,
    artifactsRoot: args.artifactsRoot,
    relFile,
    data: v,
    encoding: "utf8"
  });

  const { uri, ref } = artifactRefFromRepoRelPath(w.relPath);

  args.artifacts.push({
    kind: "text",
    path: w.relPath,
    uri,
    ref,
    role: args.field,
    bytes: w.bytes,
    mime: "text/plain",
    sha256: w.sha256
  });

  const preview = truncateUtf8(v, PREVIEW_TEXT_BYTES);
  args.output[args.field] = `${preview}\n...[truncated, full ${args.field} saved to ${w.relPath}]`;

  // Keep the toolhost's own truncation flags as-is; we add a separate marker.
  args.output.redacted = { ...(args.output.redacted ?? {}), [args.field]: true };
}

async function sanitizeExecResultForUiAndModel(args: {
  rootDir: string;
  sessionId: string;
  callId: string;
  output: any;
}): Promise<any> {
  const out = args.output;
  if (!out || typeof out !== "object" || out.type !== "exec_result") return out;

  const artifactsRoot = path.join(args.rootDir, ".eclia", "artifacts");
  try {
    await fsp.mkdir(artifactsRoot, { recursive: true });
  } catch {
    // ignore
  }

  const artifacts: ArtifactRef[] = Array.isArray((out as any).artifacts) ? (out as any).artifacts : [];

  // Generic safety: large stdout/stderr gets externalized to artifacts.
  await externalizeLargeTextField({
    rootDir: args.rootDir,
    artifactsRoot,
    sessionId: args.sessionId,
    callId: args.callId,
    output: out,
    field: "stdout",
    artifacts
  });

  await externalizeLargeTextField({
    rootDir: args.rootDir,
    artifactsRoot,
    sessionId: args.sessionId,
    callId: args.callId,
    output: out,
    field: "stderr",
    artifacts
  });

  if (artifacts.length) (out as any).artifacts = artifacts;

  return out;
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

function guessMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".txt":
    case ".log":
    case ".md":
      return "text/plain; charset=utf-8";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function handleArtifacts(req: http.IncomingMessage, res: http.ServerResponse, rootDir: string) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { ok: false, error: "method_not_allowed" });

  const u = new URL(req.url ?? "/", "http://localhost");
  const rel = u.searchParams.get("path") ?? "";
  if (!rel) return json(res, 400, { ok: false, error: "missing_path" });

  // Normalize path separators (Windows clients may send backslashes).
  const relNorm = rel.replace(/\\/g, "/");

  // Resolve to an absolute path and restrict to <root>/.eclia/artifacts/**.
  const artifactsRoot = path.resolve(rootDir, ".eclia", "artifacts");
  const abs = path.resolve(rootDir, relNorm);

  if (abs !== artifactsRoot && !abs.startsWith(artifactsRoot + path.sep)) {
    return json(res, 403, { ok: false, error: "forbidden" });
  }

  let st: fs.Stats;
  try {
    st = await fsp.stat(abs);
  } catch {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  if (!st.isFile()) return json(res, 404, { ok: false, error: "not_found" });

  const mime = guessMimeFromPath(abs);
  const filename = path.basename(abs);
  const inline = mime.startsWith("image/") || mime.startsWith("text/") || mime === "application/json";

  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", String(st.size));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename}"`);

  if (req.method === "HEAD") {
    res.writeHead(200);
    res.end();
    return;
  }

  res.writeHead(200);
  fs.createReadStream(abs).pipe(res);
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
    const origin = body?.origin && typeof body.origin === "object" ? body.origin : undefined;

    try {
      let meta = id
        ? await store.ensureSession(id, {
            v: 1,
            id,
            title: title && title.trim() ? title.trim() : "New session",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            origin
          })
        : await store.createSession(title);

      if (!id && origin) {
        // For new sessions, persist origin metadata (used by tools like `send`).
        meta = await store.updateMeta(meta.id, { origin });
      }

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

async function handleChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
  approvals: ToolApprovalHub,
  toolhost: {
    mcp: McpStdioClient;
    toolsForModel: any[];
    nameToMcpTool: (name: string) => string;
  }
) {
  const mcpExec = toolhost.mcp;
  const toolsForModel = toolhost.toolsForModel;
  const nameToMcpTool = toolhost.nameToMcpTool;
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
  const streamMode: "full" | "final" = body.streamMode === "final" ? "final" : "full";
  const requestedOrigin =
    body.origin &&
    typeof body.origin === "object" &&
    !Array.isArray(body.origin) &&
    typeof (body.origin as any).kind === "string"
      ? (body.origin as any)
      : undefined;

  return await withSessionLock(sessionId, async () => {
    // If the client disconnected while waiting in the per-session queue, don't do work.
    if ((req as any).aborted || (req.socket as any)?.destroyed || res.writableEnded) return;

    const { config, raw, rootDir } = loadEcliaConfig(process.cwd());
    const provider = config.inference.provider;

  // Ensure store is initialized and session exists.
  await store.init();
  let prior: SessionDetail;
  try {
    const existing = await store.readSession(sessionId);
    if (existing) {
      prior = existing;
      // If this session was created without origin metadata (e.g. older sessions), persist it now.
      if (requestedOrigin && !existing.meta.origin) {
        prior.meta = await store.updateMeta(sessionId, { origin: requestedOrigin, updatedAt: Date.now() });
      }
    } else {
      const seed = requestedOrigin
        ? ({
            v: 1,
            id: sessionId,
            title: "New session",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            origin: requestedOrigin
          } as any)
        : undefined;
      prior = { meta: await store.ensureSession(sessionId, seed), messages: [] };
    }
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
    initSse(res);
    const stopKeepAlive = startSseKeepAlive(res);
    send(res, "meta", { sessionId, model: routeModel });
    send(res, "error", { message: `Unsupported provider: ${provider}` });
    send(res, "done", {});
    stopKeepAlive();
    res.end();
    return;
  }

  const baseUrl = config.inference.openai_compat.base_url;
  const apiKey = config.inference.openai_compat.api_key ?? "";
  const authHeader = config.inference.openai_compat.auth_header ?? "Authorization";
  const upstreamModel = resolveUpstreamModel(routeModel, config);

  if (!apiKey.trim()) {
    res.writeHead(200, sseHeaders());
    initSse(res);
    const stopKeepAlive = startSseKeepAlive(res);
    send(res, "meta", { sessionId, model: routeModel });
    send(res, "error", {
      message:
        "Missing API key. Set inference.openai_compat.api_key in eclia.config.local.toml (or add it in Settings)."
    });
    send(res, "done", {});
    stopKeepAlive();
    res.end();
    return;
  }

  const tokenLimit = safeInt(body.contextTokenLimit, 20000);
  const history = [...prior.messages, userMsg];

  const { messages: contextMessages, usedTokens, dropped } = buildTruncatedContext(history, tokenLimit);

  res.writeHead(200, sseHeaders());
  initSse(res);
  const stopKeepAlive = startSseKeepAlive(res);
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
        tools: toolsForModel,
        onDelta: (text) => {
          if (streamMode === "full") send(res, "delta", { text });
        }
      });

      const assistantText = turn.assistantText;
      const toolCallsMap = turn.toolCalls;

      if (turn.finishReason === "tool_calls" && toolCallsMap.size === 0) {
        console.warn(
          `[gateway] finish_reason=tool_calls but parsed 0 tool calls (provider=${origin.vendor} model=${upstreamModel})`
        );
      }

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
      if (streamMode === "full") send(res, "assistant_end", {});

      const toolCalls = Array.from(toolCallsMap.values()).filter((c) => c.name && c.name.trim());
      toolCalls.sort((a, b) => (a.index ?? 999999) - (b.index ?? 999999));

      if (toolCalls.length === 0) {
        // No tool calls: final answer.
        if (streamMode === "final") send(res, "final", { text: assistantText });
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

        if (streamMode === "full") send(res, "tool_call", {
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

            const invokeExec = async (): Promise<{ ok: boolean; result: any }> => {
              const mcpToolName = nameToMcpTool(name);
              const callTimeoutMs = Math.max(
                5_000,
                Math.min(60 * 60_000, (execArgs?.timeoutMs ?? 60_000) + 15_000)
              );

              let mcpOut: any;
              try {
                const mcpArgs =
                  parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? { ...(parsed as any), __eclia: { sessionId, callId: call.callId } }
                    : { __eclia: { sessionId, callId: call.callId } };

                mcpOut = await mcpExec.callTool(mcpToolName, mcpArgs, { timeoutMs: callTimeoutMs });
              } catch (e: any) {
                const msg = String(e?.message ?? e);
                return {
                  ok: false,
                  result: {
                    type: "exec_result",
                    ok: false,
                    error: { code: "toolhost_error", message: msg },
                    args: execArgs ?? parsed
                  }
                };
              }

              const firstText = Array.isArray(mcpOut?.content)
                ? (mcpOut.content.find((c: any) => c && c.type === "text" && typeof c.text === "string") as any)?.text
                : "";

              // Prefer MCP structuredContent when available (canonical machine-readable payload).
              // Fall back to parsing the first text block for backward compatibility.
              let execOut: any = null;
              if (mcpOut && typeof mcpOut === "object" && (mcpOut as any).structuredContent && typeof (mcpOut as any).structuredContent === "object") {
                execOut = (mcpOut as any).structuredContent;
              } else {
                try {
                  execOut = firstText ? JSON.parse(firstText) : null;
                } catch {
                  execOut = null;
                }
              }

              if (!execOut || typeof execOut !== "object") {
                return {
                  ok: false,
                  result: {
                    type: "exec_result",
                    ok: false,
                    error: { code: "toolhost_bad_result", message: "Toolhost returned an invalid result" },
                    raw: firstText || safeJsonStringify(mcpOut)
                  }
                };
              }

              const nextOk = Boolean(execOut.ok) && !mcpOut?.isError;
              return { ok: nextOk, result: { ...execOut, ok: nextOk } };
            };

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
                const r = await invokeExec();
                ok = r.ok;
                output = {
                  type: "exec_result",
                  ...r.result,
                  ok,
                  policy: { mode: toolAccessMode, ...check, approvalId: waiter?.approvalId, decision: "approve" }
                };
              }
            } else {
              const r = await invokeExec();
              ok = r.ok;
              output = {
                type: "exec_result",
                ...r.result,
                ok,
                policy: { mode: toolAccessMode, ...check }
              };
            }
          }
        } else {
          ok = false;
          output = { ok: false, error: { code: "unknown_tool", message: `Unknown tool: ${name}` } };
        }

// Prevent huge tool payloads (e.g. base64 images) from freezing the UI or blowing up the model context.
if (output && typeof output === "object" && (output as any).type === "exec_result") {
  output = await sanitizeExecResultForUiAndModel({ rootDir, sessionId, callId: call.callId, output });
}



        // Stream to UI
        if (streamMode === "full") send(res, "tool_result", { callId: call.callId, name, ok, result: output });

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
      if (streamMode === "full") send(res, "assistant_start", { messageId: crypto.randomUUID() });
    }

    await store.updateMeta(sessionId, { updatedAt: Date.now(), lastModel: routeModel || upstreamModel });

    if (!res.writableEnded) {
      send(res, "done", {});
      stopKeepAlive();
      res.end();
    }
  } catch (e: any) {
    if (clientClosed) return;
    if (!res.writableEnded) {
      send(res, "error", { message: String(e?.message ?? e) });
      send(res, "done", {});
      stopKeepAlive();
      res.end();
    }
  }
  });
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
        },
        adapters: {
          discord: {
            enabled: Boolean(config.adapters.discord.enabled),
            app_id: String(config.adapters.discord.app_id ?? ""),
            app_id_configured: Boolean(config.adapters.discord.app_id && config.adapters.discord.app_id.trim()),
            bot_token_configured: Boolean(config.adapters.discord.bot_token && config.adapters.discord.bot_token.trim())
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
    if (body.adapters?.discord) patch.adapters = { discord: body.adapters.discord };

    // Optional: if user sends api_key="", treat as "do not change".
    if (patch.inference?.openai_compat && typeof patch.inference.openai_compat.api_key === "string") {
      if (!patch.inference.openai_compat.api_key.trim()) delete patch.inference.openai_compat.api_key;
    }

    // Optional: if user sends bot_token="", treat as "do not change".
    if (patch.adapters?.discord && typeof patch.adapters.discord.bot_token === "string") {
      if (!patch.adapters.discord.bot_token.trim()) delete patch.adapters.discord.bot_token;
    }

    // Optional: if user sends app_id="", treat as "do not change".
    if (patch.adapters?.discord && typeof patch.adapters.discord.app_id === "string") {
      if (!patch.adapters.discord.app_id.trim()) delete patch.adapters.discord.app_id;
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

  // MCP exec toolhost (stdio) ------------------------------------------------

  const toolhostApp = process.platform === "win32" ? "toolhost-exec-win32" : "toolhost-exec-posix";
  const toolhostEntry = path.join(rootDir, "apps", toolhostApp, "server", "index.js");
  const mcpExec = await McpStdioClient.spawn({
    command: process.execPath,
    argv: [toolhostEntry],
    cwd: rootDir,
    env: process.env,
    label: toolhostApp
  });

  // Discover tools (MCP tools/list) and adapt them to upstream OpenAI tool schema.
  const mcpTools = await mcpExec.listTools();
  const execTool = mcpTools.find((t) => t && t.name === "exec");
  if (!execTool) {
    console.error(`[gateway] fatal: toolhost did not expose required tool: exec`);
    process.exit(1);
  }

  const parameters = (execTool as McpToolDef).inputSchema ?? { type: "object" };

  const toolsForModel = [
    {
      type: "function",
      function: {
        name: EXEC_TOOL_NAME,
        description:
          execTool.description ||
          "Execute a command on the local machine. Prefer 'cmd'+'args' for safety. Returns stdout/stderr/exitCode.",
        parameters
      }
    },
    {
      type: "function",
      function: {
        name: EXECUTION_TOOL_NAME,
        description:
          execTool.description ||
          "Alias of 'exec'. Execute a command on the local machine. Prefer 'cmd'+'args' for safety.",
        parameters
      }
    }
  ];

  const toolhost = {
    mcp: mcpExec,
    toolsForModel,
    nameToMcpTool: (name: string) => (name === EXECUTION_TOOL_NAME ? EXEC_TOOL_NAME : name)
  };

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

    if (pathname === "/api/artifacts") return await handleArtifacts(req, res, rootDir);

    if (pathname.startsWith("/api/sessions")) return await handleSessions(req, res, store);

    if (pathname === "/api/tool-approvals") return await handleToolApprovals(req, res, approvals);

    if (pathname === "/api/chat" && req.method === "POST") return await handleChat(req, res, store, approvals, toolhost);

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
