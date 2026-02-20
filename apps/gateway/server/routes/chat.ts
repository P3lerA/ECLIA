import http from "node:http";
import crypto from "node:crypto";

import {
  loadEcliaConfig
} from "@eclia/config";

import { SessionStore } from "../sessionStore.js";
import type { SessionDetail, SessionEventV1, SessionMetaV1, StoredMessage } from "../sessionTypes.js";
import { blocksFromAssistantRaw, textBlock } from "../normalize.js";
import { ToolApprovalHub } from "../tools/approvalHub.js";
import { parseExecArgs } from "../tools/execTool.js";
import { checkExecNeedsApproval, loadExecAllowlist, type ToolAccessMode } from "../tools/policy.js";
import { checkSendNeedsApproval, parseSendArgs, prepareSendAttachments } from "../tools/sendTool.js";
import {
  planToolApproval,
  waitForToolApproval,
  approvalOutcomeToError,
  type ToolSafetyCheck,
  type ToolApprovalWaiter
} from "../tools/approvalFlow.js";
import { EXEC_TOOL_NAME, EXECUTION_TOOL_NAME, SEND_TOOL_NAME } from "../tools/toolSchemas.js";
import { McpStdioClient } from "../mcp/stdioClient.js";
import { sseHeaders, initSse, send, startSseKeepAlive } from "../sse.js";
import { withSessionLock } from "../sessionLock.js";
import { resolveUpstreamBackend } from "../upstream/resolve.js";
import type { ToolCall } from "../upstream/provider.js";
import { json, readJson, safeInt, safeJsonStringify } from "../httpUtils.js";
import { sanitizeExecResultForUiAndModel } from "../tools/execResultSanitize.js";
import { composeSystemInstruction } from "../instructions/systemInstruction.js";
import { buildSkillsInstructionPart } from "../instructions/skillsInstruction.js";

import { appendSessionWarning } from "../debug/warnings.js";
import { parseAssistantToolCallsFromText } from "../tools/assistantOutputParse.js";

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

type Toolhost = {
  mcp: McpStdioClient;
  toolsForModel: any[];
  nameToMcpTool: (name: string) => string;
};

function isToolCall(v: unknown): v is ToolCall {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as any).callId === "string" &&
    typeof (v as any).name === "string" &&
    typeof (v as any).argsRaw === "string" &&
    ((v as any).index === undefined || typeof (v as any).index === "number")
  );
}

function deriveTitle(userText: string): string {
  const s = userText.replace(/\s+/g, " ").trim();
  if (!s) return "New session";
  const max = 64;
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

function firstUserTextInSession(messages: StoredMessage[]): string | null {
  for (const m of messages) {
    if (!m || m.role !== "user") continue;
    const raw = typeof m.raw === "string" ? m.raw : "";
    const t = raw.trim();
    if (t) return t;
  }
  return null;
}

function deriveTitleFromOrigin(origin: SessionMetaV1["origin"] | undefined): string | null {
  if (!origin || typeof origin !== "object") return null;
  const kind = typeof (origin as any).kind === "string" ? (origin as any).kind : "";
  if (kind !== "discord") return null;

  const guildName = typeof (origin as any).guildName === "string" ? (origin as any).guildName.trim() : "";
  const channelName = typeof (origin as any).channelName === "string" ? (origin as any).channelName.trim() : "";
  const threadName = typeof (origin as any).threadName === "string" ? (origin as any).threadName.trim() : "";

  const guildId = typeof (origin as any).guildId === "string" ? (origin as any).guildId.trim() : "";
  const channelId = typeof (origin as any).channelId === "string" ? (origin as any).channelId.trim() : "";
  const threadId = typeof (origin as any).threadId === "string" ? (origin as any).threadId.trim() : "";

  const parts: string[] = [];
  parts.push("Discord");

  if (guildName) parts.push(guildName);
  else if (guildId) parts.push(`g${guildId}`);

  if (channelName) parts.push(`#${channelName}`);
  else if (channelId) parts.push(`c${channelId}`);

  if (threadName) parts.push(threadName);
  else if (threadId) parts.push(`t${threadId}`);

  const s = parts.filter(Boolean).join(" · ").trim();
  if (!s) return null;

  // Keep titles short-ish for UI lists.
  return s.length > 96 ? s.slice(0, 96).trimEnd() + "…" : s;
}

function guessDiscordAdapterBaseUrl(): string {
  const explicit = (process.env.ECLIA_DISCORD_ADAPTER_URL ?? "").trim();
  if (explicit) return explicit;
  const portRaw = (process.env.ECLIA_DISCORD_ADAPTER_PORT ?? "8790").trim();
  const port = Number(portRaw);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 8790}`;
}

async function postDiscordAdapterSend(args: {
  adapterBaseUrl: string;
  adapterKey?: string;
  origin: any;
  content: string;
  refs: string[];
}): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }> {
  const url = `${args.adapterBaseUrl.replace(/\/$/, "")}/send`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = typeof args.adapterKey === "string" ? args.adapterKey.trim() : "";
  if (key) headers["x-eclia-adapter-key"] = key;

  const payload = {
    origin: args.origin,
    content: args.content,
    refs: Array.isArray(args.refs) ? args.refs : []
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: ctrl.signal as any });
    const j = (await r.json().catch(() => null)) as any;
    if (!r.ok || !j?.ok) {
      const err = typeof j?.error === "string" ? j.error : `http_${r.status}`;
      return { ok: false, error: { code: "send_failed", message: `Discord adapter send failed: ${err}` } };
    }
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.name === "AbortError" ? "timeout" : e?.message ?? e);
    return { ok: false, error: { code: "adapter_unreachable", message: `Discord adapter unreachable: ${msg}` } };
  } finally {
    clearTimeout(t);
  }
}

function extractRequestedOrigin(body: ChatReqBody): SessionMetaV1["origin"] | undefined {
  const o = body.origin;
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  if (typeof (o as any).kind !== "string") return undefined;
  return o as any;
}

async function persistAssistantText(args: {
  store: SessionStore;
  sessionId: string;
  text: string;
  origin: { adapter: string; vendor?: string; baseUrl?: string; model?: string };
}) {
  const assistantMsg: StoredMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    createdAt: Date.now(),
    raw: args.text,
    blocks: blocksFromAssistantRaw(args.text, args.origin)
  };

  const assistantEv: SessionEventV1 = {
    v: 1,
    id: crypto.randomUUID(),
    ts: assistantMsg.createdAt,
    type: "message",
    message: assistantMsg
  };

  await args.store.appendEvent(args.sessionId, assistantEv, { touchMeta: false });
}

async function persistAssistantError(args: {
  store: SessionStore;
  sessionId: string;
  message: string;
}) {
  const text = args.message.trim() ? args.message.trim() : "Unknown error";
  const msg: StoredMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    createdAt: Date.now(),
    raw: text,
    blocks: [textBlock(`[error] ${text}`, { adapter: "gateway" })]
  };

  const ev: SessionEventV1 = {
    v: 1,
    id: crypto.randomUUID(),
    ts: msg.createdAt,
    type: "message",
    message: msg
  };

  await args.store.appendEvent(args.sessionId, ev, { touchMeta: false });
}

function beginSse(res: http.ServerResponse): { stopKeepAlive: () => void } {
  res.writeHead(200, sseHeaders());
  initSse(res);
  const stopKeepAlive = startSseKeepAlive(res);
  return { stopKeepAlive };
}

export async function handleChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  store: SessionStore,
  approvals: ToolApprovalHub,
  toolhost: Toolhost
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
  const requestedOrigin = extractRequestedOrigin(body);

  return await withSessionLock(sessionId, async () => {
    // If the client disconnected while waiting in the per-session queue, don't do work.
    if ((req as any).aborted || (req.socket as any)?.destroyed || res.writableEnded) return;

    const { config, raw, rootDir } = loadEcliaConfig(process.cwd());

    // Global system instruction (from TOML). Injected as the ONLY role=system message for all providers.
    const { text: systemInstruction } = composeSystemInstruction([
      {
        id: "toml",
        source: "toml",
        priority: 100,
        content: typeof (config.inference as any)?.system_instruction === "string" ? String((config.inference as any).system_instruction) : ""
      },

      // Skills (enabled by user in TOML; only inject enabled names + one-line summaries).
      buildSkillsInstructionPart(rootDir, config.skills.enabled)
    ]);

    // Ensure store is initialized and session exists.
    await store.init();

    let prior: SessionDetail;
    const metaPatch: Partial<SessionMetaV1> = {};

    try {
      // Include tool events when projecting the session, otherwise the next turn "forgets" tool results.
      const existing = await store.readSession(sessionId, { includeTools: true });
      if (existing) {
        prior = existing;
        // Persist/merge origin metadata when provided.
        // For example: discord adapter now sends guildName/channelName, which is useful for session titles.
        if (requestedOrigin) {
          if (!existing.meta.origin) {
            metaPatch.origin = requestedOrigin;
          } else {
            const ek = typeof (existing.meta.origin as any)?.kind === "string" ? String((existing.meta.origin as any).kind) : "";
            const rk = typeof (requestedOrigin as any)?.kind === "string" ? String((requestedOrigin as any).kind) : "";
            if (ek && rk && ek === rk) metaPatch.origin = { ...(existing.meta.origin as any), ...(requestedOrigin as any) };
          }
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

    // Session titling strategy:
    // - Default behavior: first user message.
    // - Discord behavior: prefer guild/channel/thread names (if provided in origin).
    // - Migration: if an older discord session was titled by the first prompt, retitle it.
    const originTitle = deriveTitleFromOrigin(requestedOrigin);
    const hasDefaultTitle = prior.meta.title === "New session" || !prior.meta.title.trim();

    if (prior.messages.length === 0 && hasDefaultTitle) {
      metaPatch.title = originTitle ?? deriveTitle(userText);
    } else if (originTitle) {
      const firstUserText = firstUserTextInSession(prior.messages);
      const legacyTitle = firstUserText ? deriveTitle(firstUserText) : null;
      if (legacyTitle && prior.meta.title === legacyTitle) metaPatch.title = originTitle;
      else if (hasDefaultTitle) metaPatch.title = originTitle;
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
    await store.appendEvent(sessionId, userEv, { touchMeta: false });

    // Resolve upstream backend (provider + credentials).
    let backend: ReturnType<typeof resolveUpstreamBackend>;
    try {
      backend = resolveUpstreamBackend(routeModel, config);
    } catch (e: any) {
      const { stopKeepAlive } = beginSse(res);
      send(res, "meta", { sessionId, model: routeModel });

      const msg = String(e?.message ?? e);
      await persistAssistantError({ store, sessionId, message: msg });
      await store.updateMeta(sessionId, { ...metaPatch, updatedAt: Date.now(), lastModel: routeModel });

      send(res, "error", { message: msg });
      send(res, "done", {});
      stopKeepAlive();
      res.end();
      return;
    }

    // Resolve request headers (may be static today, but can be dynamic later via OAuth).
    let headers: Record<string, string>;
    try {
      headers = await backend.credentials.getHeaders();
    } catch (e: any) {
      const { stopKeepAlive } = beginSse(res);
      send(res, "meta", { sessionId, model: routeModel });

      const msg = String(e?.message ?? e);
      await persistAssistantError({ store, sessionId, message: msg });
      await store.updateMeta(sessionId, { ...metaPatch, updatedAt: Date.now(), lastModel: routeModel || backend.upstreamModel });

      send(res, "error", { message: msg });
      send(res, "done", {});
      stopKeepAlive();
      res.end();
      return;
    }

    const tokenLimit = safeInt(body.contextTokenLimit, 20000);
    const historyBase = [...prior.messages, userMsg].filter((m) => m && m.role !== "system");

    // Inject system instruction as the only system message (when configured).
    const historyForContext = systemInstruction.trim().length
      ? [
          ...historyBase,
          {
            id: crypto.randomUUID(),
            role: "system",
            createdAt: Date.now(),
            raw: systemInstruction,
            blocks: [textBlock(systemInstruction, { adapter: "gateway" })]
          }
        ]
      : historyBase;

    const { messages: contextMessages, usedTokens, dropped } = backend.provider.buildContext(historyForContext, tokenLimit);

    const { stopKeepAlive } = beginSse(res);
    send(res, "meta", { sessionId, model: routeModel, usedTokens, dropped });

    console.log(
      `[gateway] POST /api/chat  session=${sessionId} model=${backend.upstreamModel} ctx≈${usedTokens} dropped=${dropped} tools=on mode=${toolAccessMode}`
    );

    const execAllowlist = loadExecAllowlist(raw);

    const upstreamAbort = new AbortController();
    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
      upstreamAbort.abort();
      approvals.cancelSession(sessionId);
    });

    const origin = backend.provider.origin;

    const captureUpstreamRequests = Boolean((config as any)?.debug?.capture_upstream_requests);
    let upstreamReqSeq = 0;

    // We build the upstream transcript progressively so tool results are fed back correctly.
    const upstreamMessages: any[] = [...contextMessages];

    try {
      // Multi-turn tool loop
      while (!clientClosed) {
        const turn = await backend.provider.streamTurn({
          headers,
          messages: upstreamMessages,
          signal: upstreamAbort.signal,
          tools: toolsForModel,
          onDelta: (text) => {
            if (streamMode === "full") send(res, "delta", { text });
          },
          debug: captureUpstreamRequests ? { rootDir, sessionId, seq: ++upstreamReqSeq } : undefined
        });

        const assistantText = turn.assistantText;
        let toolCallsMap = turn.toolCalls;

        const parseAssistantOutput = Boolean((config as any)?.debug?.parse_assistant_output);
        const parsedWarningByCall = new Map<string, string>();
        if (parseAssistantOutput && toolCallsMap.size === 0) {
          const allowed = new Set<string>([EXEC_TOOL_NAME, EXECUTION_TOOL_NAME, SEND_TOOL_NAME]);
          // Also allow any tool names that are actually exposed to the model for this request.
          for (const t of toolsForModel as any[]) {
            const n = typeof t?.function?.name === "string" ? t.function.name : typeof t?.name === "string" ? t.name : "";
            if (n) allowed.add(n);
          }

          const parsed = parseAssistantToolCallsFromText(assistantText, allowed);
          if (parsed.length) {
            // NOTE: We keep assistantText as-is (it may contain the transcript).
            // This is a compatibility fallback; the warning below makes it visible in approval UI and debug logs.
            toolCallsMap = new Map();
            for (const row of parsed) {
              toolCallsMap.set(row.call.callId, row.call);
              parsedWarningByCall.set(row.call.callId, row.warning);

              appendSessionWarning({
                rootDir,
                sessionId,
                event: {
                  kind: "parsed_assistant_output_tool_call",
                  provider: origin.vendor ?? origin.adapter,
                  upstreamModel: backend.upstreamModel,
                  tool: row.call.name,
                  callId: row.call.callId,
                  line: row.line
                }
              });
            }

            console.warn(
              `[gateway] Parsed ${parsed.length} tool call(s) from assistant plaintext output (provider=${origin.vendor} model=${backend.upstreamModel}).`
            );
          }
        }

        if (turn.finishReason === "tool_calls" && toolCallsMap.size === 0) {
          console.warn(
            `[gateway] finish_reason=tool_calls but parsed 0 tool calls (provider=${origin.vendor} model=${backend.upstreamModel})`
          );
        }

        // Persist assistant message (even if empty; it anchors tool blocks).
        await persistAssistantText({ store, sessionId, text: assistantText, origin });

        // Close the current assistant streaming phase in the UI.
        if (streamMode === "full") send(res, "assistant_end", {});

        const toolCalls = Array.from(toolCallsMap.values())
          .filter(isToolCall)
          .filter((c) => c.name && c.name.trim());
        toolCalls.sort((a, b) => (a.index ?? 999999) - (b.index ?? 999999));

        if (toolCalls.length === 0) {
          // No tool calls: final answer.
          if (streamMode === "final") send(res, "final", { text: assistantText });
          break;
        }

        // Append the provider-specific assistant tool-call message to the upstream transcript.
        upstreamMessages.push(backend.provider.buildAssistantToolCallMessage({ assistantText, toolCalls }));

        // Emit tool_call blocks (now we have complete args) and persist them.
        const approvalWaiters = new Map<string, ToolApprovalWaiter>();
        const safetyCheckByCall = new Map<string, ToolSafetyCheck>();
        const parsedArgsByCall = new Map<string, any>();
        const parsedExecArgsByCall = new Map<string, ReturnType<typeof parseExecArgs>>();
        const parsedSendArgsByCall = new Map<string, ReturnType<typeof parseSendArgs>>();
        const parseErrorByCall = new Map<string, string | undefined>();

        for (const call of toolCalls) {
          const tev: SessionEventV1 = {
            v: 1,
            id: crypto.randomUUID(),
            ts: Date.now(),
            type: "tool_call",
            call: { callId: call.callId, name: call.name, argsRaw: call.argsRaw }
          };
          await store.appendEvent(sessionId, tev, { touchMeta: false });

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

          let approvalInfo: any = null;

          if (call.name === EXEC_TOOL_NAME || call.name === EXECUTION_TOOL_NAME) {
            const execArgs = parseExecArgs(parsed);
            parsedExecArgsByCall.set(call.callId, execArgs);

            const check = checkExecNeedsApproval(execArgs, toolAccessMode, execAllowlist);
            safetyCheckByCall.set(call.callId, check);

            const plan = planToolApproval({ approvals, sessionId, check, timeoutMs: 5 * 60_000 });
            if (plan.waiter) approvalWaiters.set(call.callId, plan.waiter);
            approvalInfo = plan.approval;
          } else if (call.name === SEND_TOOL_NAME) {
            const sendArgs = parseSendArgs(parsed);
            parsedSendArgsByCall.set(call.callId, sendArgs);

            const check = checkSendNeedsApproval(sendArgs, toolAccessMode);
            safetyCheckByCall.set(call.callId, check);

            const plan = planToolApproval({ approvals, sessionId, check, timeoutMs: 5 * 60_000 });
            if (plan.waiter) approvalWaiters.set(call.callId, plan.waiter);
            approvalInfo = plan.approval;
          }

          if (streamMode === "full")
            send(res, "tool_call", {
              callId: call.callId,
              name: call.name,
              args: {
                sessionId,
                raw: call.argsRaw,
                parsed,
                parseError,
                approval: approvalInfo,
                parseWarning: parsedWarningByCall.get(call.callId)
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
          const sendArgs = parsedSendArgsByCall.get(call.callId);

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
              const check = safetyCheckByCall.get(call.callId) ?? checkExecNeedsApproval(execArgs ?? {}, toolAccessMode, execAllowlist);
              const waiter = approvalWaiters.get(call.callId);

              const invokeExec = async (): Promise<{ ok: boolean; result: any }> => {
                const mcpToolName = nameToMcpTool(name);
                const callTimeoutMs = Math.max(5_000, Math.min(60 * 60_000, (execArgs?.timeoutMs ?? 60_000) + 15_000));

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
                  ? (mcpOut.content.find((c: any) => c && c.type === "text" && typeof c.text === "string") as any)
                      ?.text
                  : "";

                // Prefer MCP structuredContent when available (canonical machine-readable payload).
                // Fall back to parsing the first text block for backward compatibility.
                let execOut: any = null;
                if (
                  mcpOut &&
                  typeof mcpOut === "object" &&
                  (mcpOut as any).structuredContent &&
                  typeof (mcpOut as any).structuredContent === "object"
                ) {
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
                const decision = await waitForToolApproval(waiter);
                if (decision.decision !== "approve") {
                  ok = false;
                  output = {
                    type: "exec_result",
                    ok: false,
                    error: approvalOutcomeToError(decision, { actionLabel: "execution" }),
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
          } else if (name === SEND_TOOL_NAME) {
            if (parseError) {
              ok = false;
              output = {
                type: "send_result",
                ok: false,
                error: { code: "bad_arguments_json", message: `Invalid JSON arguments: ${parseError}` },
                argsRaw: call.argsRaw
              };
            } else {
              const args = sendArgs ?? parseSendArgs(parsed);
              const check = safetyCheckByCall.get(call.callId) ?? checkSendNeedsApproval(args, toolAccessMode);
              const waiter = approvalWaiters.get(call.callId);

              const invokeSend = async (): Promise<{ ok: boolean; result: any }> => {
                // Destination resolution:
                // - Default is "origin" (request source).
                // - Fallback to persisted session origin.
                const effectiveOrigin = (requestedOrigin ?? metaPatch.origin ?? prior.meta.origin ?? { kind: "web" }) as any;

                let destination: any = args.destination;
                if (!destination || destination.kind === "origin") destination = effectiveOrigin;

                // If the model specified {kind:"discord"} without ids, inherit from origin when possible.
                if (destination && destination.kind === "discord") {
                  if (!destination.channelId && effectiveOrigin?.kind === "discord") {
                    destination = { ...effectiveOrigin, ...destination };
                    if (!destination.channelId) destination.channelId = effectiveOrigin.channelId;
                    if (!destination.threadId && effectiveOrigin.threadId) destination.threadId = effectiveOrigin.threadId;
                  }
                }

                if (!destination || typeof destination !== "object") {
                  return {
                    ok: false,
                    result: {
                      type: "send_result",
                      ok: false,
                      error: { code: "invalid_destination", message: "Destination is missing or invalid" },
                      args
                    }
                  };
                }

                const destKind = typeof destination.kind === "string" ? destination.kind : "";
                if (destKind !== "web" && destKind !== "discord") {
                  return {
                    ok: false,
                    result: {
                      type: "send_result",
                      ok: false,
                      error: { code: "invalid_destination", message: `Unsupported destination kind: ${String(destKind)}` },
                      args
                    }
                  };
                }

                const prep = await prepareSendAttachments({
                  rootDir,
                  sessionId,
                  callId: call.callId,
                  refs: args.refs,
                  paths: args.paths
                });

                if (!prep.ok) {
                  return { ok: false, result: { type: "send_result", ok: false, error: prep.error, args } };
                }

                // Deliver
                if (destKind === "discord") {
                  if (!config.adapters.discord.enabled) {
                    return {
                      ok: false,
                      result: {
                        type: "send_result",
                        ok: false,
                        error: { code: "adapter_disabled", message: "Discord adapter is disabled" },
                        destination,
                        args,
                        artifacts: prep.value.artifacts,
                        refs: prep.value.refs
                      }
                    };
                  }

                  const channelId = typeof destination.channelId === "string" ? destination.channelId.trim() : "";
                  if (!channelId) {
                    return {
                      ok: false,
                      result: {
                        type: "send_result",
                        ok: false,
                        error: { code: "invalid_destination", message: "discord destination requires channelId" },
                        destination,
                        args
                      }
                    };
                  }

                  const r = await postDiscordAdapterSend({
                    adapterBaseUrl: guessDiscordAdapterBaseUrl(),
                    adapterKey: process.env.ECLIA_ADAPTER_KEY,
                    origin: { ...destination, kind: "discord", channelId },
                    content: typeof args.content === "string" ? args.content : "",
                    refs: prep.value.refs
                  });

                  if (!r.ok) {
                    return {
                      ok: false,
                      result: {
                        type: "send_result",
                        ok: false,
                        error: r.error,
                        destination,
                        args,
                        artifacts: prep.value.artifacts,
                        refs: prep.value.refs
                      }
                    };
                  }
                }

                return {
                  ok: true,
                  result: {
                    type: "send_result",
                    ok: true,
                    destination,
                    content: typeof args.content === "string" ? args.content : "",
                    refs: prep.value.refs,
                    artifacts: prep.value.artifacts,
                    copiedFromPaths: prep.value.copiedFromPaths
                  }
                };
              };

              if (check.requireApproval) {
                const decision = await waitForToolApproval(waiter);
                if (decision.decision !== "approve") {
                  ok = false;
                  output = {
                    type: "send_result",
                    ok: false,
                    error: approvalOutcomeToError(decision, { actionLabel: "send" }),
                    policy: { mode: toolAccessMode, ...check, approvalId: waiter?.approvalId },
                    args
                  };
                } else {
                  const r = await invokeSend();
                  ok = r.ok;
                  output = {
                    type: "send_result",
                    ...r.result,
                    ok,
                    policy: { mode: toolAccessMode, ...check, approvalId: waiter?.approvalId, decision: "approve" }
                  };
                }
              } else {
                const r = await invokeSend();
                ok = r.ok;
                output = {
                  type: "send_result",
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
          await store.appendEvent(sessionId, rev, { touchMeta: false });

          // Feed back to model
          toolMessages.push(
            backend.provider.buildToolResultMessage({ callId: call.callId, content: safeJsonStringify(output) })
          );
        }

        upstreamMessages.push(...toolMessages);

        // Start a fresh assistant streaming phase (the model's post-tool response).
        if (streamMode === "full") send(res, "assistant_start", { messageId: crypto.randomUUID() });
      }

      await store.updateMeta(sessionId, {
        ...metaPatch,
        updatedAt: Date.now(),
        lastModel: routeModel || backend.upstreamModel
      });

      if (!res.writableEnded) {
        send(res, "done", {});
        stopKeepAlive();
        res.end();
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);

      // If the client disconnected, don't bother writing to the response, but still touch session meta.
      if (clientClosed) {
        await store.updateMeta(sessionId, {
          ...metaPatch,
          updatedAt: Date.now(),
          lastModel: routeModel || backend.upstreamModel
        });
        return;
      }

      // Persist an assistant-visible error so the UI doesn't "flash then disappear" after re-sync.
      await persistAssistantError({ store, sessionId, message: msg });
      await store.updateMeta(sessionId, { ...metaPatch, updatedAt: Date.now(), lastModel: routeModel || backend.upstreamModel });

      if (!res.writableEnded) {
        send(res, "error", { message: msg });
        send(res, "done", {});
        stopKeepAlive();
        res.end();
      }
    }
  });
}
