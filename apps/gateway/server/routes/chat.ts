import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";

import {
  canonicalizeRouteKeyForConfig,
  loadEcliaConfig,
  renderSystemInstructionTemplate
} from "@eclia/config";

import { SessionStore } from "../sessionStore.js";
import type { SessionMetaV1 } from "../sessionTypes.js";
import type { OpenAICompatMessage } from "../transcriptTypes.js";
import { ToolApprovalHub } from "../tools/approvalHub.js";
import { loadExecAllowlist, type ToolAccessMode } from "../tools/policy.js";
import { McpStdioClient } from "../mcp/stdioClient.js";
import { sseHeaders, initSse, send, startSseKeepAlive } from "../sse.js";
import { withSessionLock } from "../sessionLock.js";
import { resolveUpstreamBackend } from "../upstream/resolve.js";
import type { ToolCall } from "../upstream/provider.js";
import { json, readJson, safeInt } from "../httpUtils.js";
import { composeSystemInstruction } from "../instructions/systemInstruction.js";
import { buildSkillsInstructionPart } from "../instructions/skillsInstruction.js";
import { readGitInfo } from "../gitInfo.js";

import { appendSessionWarning } from "../debug/warnings.js";
import { parseAssistantToolCallsFromText } from "../tools/assistantOutputParse.js";

import {
  deriveTitle,
  deriveTitleFromOrigin,
  extractRequestedOrigin,
  firstUserTextInTranscript,
  transcriptRecordsToMessages
} from "../chat/sessionUtils.js";
import { runToolCalls } from "../chat/toolExecutor.js";

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
   * Optional sampling temperature override.
   * If omitted/null, provider defaults apply.
   */
  temperature?: number;

  /**
   * Optional nucleus sampling override (top_p).
   * If omitted/null, provider defaults apply.
   */
  topP?: number;

  /**
   * Optional top-k sampling override.
   * Non-standard in OpenAI, but supported by some OpenAI-compatible providers.
   */
  topK?: number;

  /**
   * Optional output token limit override.
   *
   * Note: upstream APIs vary between `max_tokens` and `max_output_tokens`.
   * The gateway normalizes this to a single field and the provider adapter
   * translates it as needed.
   */
  maxOutputTokens?: number;

  /**
   * Alias for maxOutputTokens (compat).
   */
  maxTokens?: number;

  /**
   * Tool access mode (client preference).
   * - full: auto-run tools.
   * - safe: auto-run allowlisted exec commands only; otherwise require user approval.
   */
  toolAccessMode?: ToolAccessMode;

  /**
   * Enabled tools exposed to the model for this request.
   * If omitted, all tools are enabled.
   */
  enabledTools?: string[];

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

function clampOptionalNumber(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(min, Math.min(max, n));
  return Math.round(clamped * 1000) / 1000;
}

function clampOptionalInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

/**
 * Clamp an optional int, but treat non-positive values as "unset".
 *
 * Non-positive values are accepted for backward compatibility and normalized
 * to null ("omit from upstream request").
 */
function clampOptionalPositiveInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i <= 0) return null;
  return Math.max(min, Math.min(max, i));
}

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

async function persistAssistantText(args: {
  store: SessionStore;
  sessionId: string;
  text: string;
  toolCallsForTranscript?: ToolCall[];
}) {
  // Canonical transcript (OpenAI-compatible): assistant message + optional tool_calls.
  const ts = Date.now();
  const tc = Array.isArray(args.toolCallsForTranscript) ? args.toolCallsForTranscript : [];
  const tool_calls = tc
    .filter((c) => c && typeof c.callId === "string" && typeof c.name === "string" && typeof c.argsRaw === "string")
    .map((c) => ({
      id: c.callId,
      type: "function" as const,
      function: {
        name: c.name,
        arguments: c.argsRaw
      }
    }));

  await args.store.appendTranscript(
    args.sessionId,
    {
      role: "assistant",
      content: args.text,
      ...(tool_calls.length ? { tool_calls } : {})
    } as any,
    ts
  );
}

async function persistAssistantError(args: {
  store: SessionStore;
  sessionId: string;
  message: string;
}) {
  const text = args.message.trim() ? args.message.trim() : "Unknown error";
  const visible = `[error] ${text}`;
  await args.store.appendTranscript(args.sessionId, { role: "assistant", content: visible } as any, Date.now());
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

  // Correlation id for this logical user turn (persisted in transcript turn metadata).
  const turnId = crypto.randomUUID();

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

  const enabledToolsRaw = Array.isArray(body.enabledTools) ? body.enabledTools : null;
  const enabledTools = enabledToolsRaw
    ? enabledToolsRaw
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter((x) => x && x.trim())
    : null;
  const enabledToolSet = enabledTools ? new Set(enabledTools) : null;

  const toolsForModelEffective = enabledToolSet
    ? (toolsForModel as any[]).filter((t) => {
        const n =
          typeof (t as any)?.function?.name === "string"
            ? String((t as any).function.name)
            : typeof (t as any)?.name === "string"
              ? String((t as any).name)
              : "";
        return n && enabledToolSet.has(n);
      })
    : toolsForModel;

  return await withSessionLock(sessionId, async () => {
    // If the client disconnected while waiting in the per-session queue, don't do work.
    if ((req as any).aborted || (req.socket as any)?.destroyed || res.writableEnded) return;

    const { config, raw, rootDir } = loadEcliaConfig(process.cwd());
    const canonicalRouteModel = canonicalizeRouteKeyForConfig(routeModel, config);

    // Best-effort provenance snapshot (commit/branch/dirty).
    const git = readGitInfo(rootDir);

    // Global system instruction (from _system.local.md, fallback _system.md).
    // Injected as the ONLY role=system message for all providers.
    const { text: systemInstruction } = composeSystemInstruction([
      {
        id: "system_file",
        source: "system_file",
        priority: 100,
        content: renderSystemInstructionTemplate(
          typeof (config.inference as any)?.system_instruction === "string" ? String((config.inference as any).system_instruction) : "",
          {
            userPreferredName: (config as any)?.persona?.user_preferred_name,
            assistantName: (config as any)?.persona?.assistant_name
          }
        )
      },

      // Optional: skills system blurb (from skills/_system.md). No code-generated boilerplate.
      buildSkillsInstructionPart(rootDir, config.skills.enabled)
    ]);

    // Ensure store is initialized and session exists.
    await store.init();

    let priorMeta!: SessionMetaV1;
    let priorMessages: OpenAICompatMessage[] = [];
    const metaPatch: Partial<SessionMetaV1> = {};

    try {
      const existing = await store.readTranscript(sessionId);
      if (existing) {
        priorMeta = existing.meta;
        priorMessages = transcriptRecordsToMessages(existing.transcript);
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
        priorMeta = await store.ensureSession(sessionId, seed);
        priorMessages = [];
      }
    } catch {
      return json(res, 400, { ok: false, error: "invalid_session_id" });
    }

    // Session titling strategy:
    // - Default behavior: first user message.
    // - Discord behavior: prefer guild/channel/thread names (if provided in origin).
    // - Migration: if an older discord session was titled by the first prompt, retitle it.
    const originTitle = deriveTitleFromOrigin(requestedOrigin);
    const hasDefaultTitle = priorMeta.title === "New session" || !priorMeta.title.trim();

    if (priorMessages.length === 0 && hasDefaultTitle) {
      metaPatch.title = originTitle ?? deriveTitle(userText);
    } else if (originTitle) {
      const firstUserText = firstUserTextInTranscript(priorMessages);
      const legacyTitle = firstUserText ? deriveTitle(firstUserText) : null;
      if (legacyTitle && priorMeta.title === legacyTitle) metaPatch.title = originTitle;
      else if (hasDefaultTitle) metaPatch.title = originTitle;
    }

    // Persist the user message first (so the session survives even if upstream fails).
    const userTs = Date.now();
    const userMsg: OpenAICompatMessage = { role: "user", content: userText } as any;
    await store.appendTranscript(sessionId, userMsg as any, userTs);

    const tokenLimit = safeInt(body.contextTokenLimit, 20000);

    const temperature = clampOptionalNumber(body.temperature, 0, 2);
    const topP = clampOptionalNumber(body.topP, 0, 1);
    const topK = clampOptionalInt(body.topK, 1, 1000);
    const maxOutputTokens = clampOptionalPositiveInt(body.maxOutputTokens ?? body.maxTokens, 1, 200_000);

    const runtimeForTurn = {
      temperature,
      topP,
      topK,
      // null means "unlimited / omitted" (provider default).
      maxOutputTokens: maxOutputTokens ?? null
    };

    const buildTurnMeta = (args: { usedTokens: number; upstreamModel?: string; upstreamBaseUrl?: string }) => {
      const baseUrl = String(args.upstreamBaseUrl ?? "");
      return {
        turnId,
        tokenLimit,
        usedTokens: args.usedTokens,
        upstream: {
          routeKey: canonicalRouteModel,
          model: String(args.upstreamModel ?? canonicalRouteModel),
          baseUrl
        },
        git,
        runtime: runtimeForTurn,
        toolAccessMode
      };
    };

    // Resolve upstream backend (provider + credentials).
    let backend: ReturnType<typeof resolveUpstreamBackend>;
    try {
      backend = resolveUpstreamBackend(canonicalRouteModel, config);
    } catch (e: any) {
      const { stopKeepAlive } = beginSse(res);
      send(res, "meta", { sessionId, model: routeModel });

      const msg = String(e?.message ?? e);
      await persistAssistantError({ store, sessionId, message: msg });
      await store.appendTurn(sessionId, buildTurnMeta({ usedTokens: 0 }), Date.now());
      await store.updateMeta(sessionId, { ...metaPatch, updatedAt: Date.now(), lastModel: canonicalRouteModel });

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
      await store.appendTurn(
        sessionId,
        buildTurnMeta({
          usedTokens: 0,
          upstreamModel: backend.upstreamModel,
          upstreamBaseUrl: backend.provider.origin.baseUrl ?? backend.provider.origin.adapter
        }),
        Date.now()
      );
      await store.updateMeta(sessionId, { ...metaPatch, updatedAt: Date.now(), lastModel: canonicalRouteModel || backend.upstreamModel });

      send(res, "error", { message: msg });
      send(res, "done", {});
      stopKeepAlive();
      res.end();
      return;
    }

    const historyBase = [...priorMessages, userMsg].filter((m) => m && m.role !== "system");

    // Inject system instruction as the only system message (when configured).
    const historyForContext = systemInstruction.trim().length
      ? [
          ...historyBase,
          ({ role: "system", content: systemInstruction } as any)
        ]
      : historyBase;

    const { messages: contextMessages, usedTokens, dropped } = backend.provider.buildContext(historyForContext, tokenLimit);

    const { stopKeepAlive } = beginSse(res);
    // NOTE: keep meta minimal; turn-level stats are persisted in transcript.ndjson.
    send(res, "meta", { sessionId, model: routeModel, usedTokens });

    console.log(
      `[gateway] POST /api/chat  session=${sessionId} model=${backend.upstreamModel} ctx≈${usedTokens} tools=${toolsForModelEffective.length ? "on" : "off"} mode=${toolAccessMode}`
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

    // Capture dumps should live alongside the session store under <repo>/.eclia/debug/<sessionId>/.
    // Derive <repo> from the store path rather than process.cwd()/config discovery to avoid surprises.
    const debugRootDir = path.dirname(path.dirname(store.sessionsDir));

    // We build the upstream transcript progressively so tool results are fed back correctly.
    const upstreamMessages: any[] = [...contextMessages];

    try {
      // Multi-turn tool loop
      while (!clientClosed) {
        const turn = await backend.provider.streamTurn({
          headers,
          messages: upstreamMessages,
          signal: upstreamAbort.signal,
          tools: toolsForModelEffective,
          temperature: temperature ?? undefined,
          topP: topP ?? undefined,
          topK: topK ?? undefined,
          maxOutputTokens: maxOutputTokens ?? undefined,
          onDelta: (text) => {
            if (streamMode === "full") send(res, "delta", { text });
          },
          debug: captureUpstreamRequests ? { rootDir: debugRootDir, sessionId, seq: ++upstreamReqSeq } : undefined
        });

        const assistantText = turn.assistantText;
        let toolCallsMap = turn.toolCalls;

        const parseAssistantOutput = Boolean((config as any)?.debug?.parse_assistant_output);
        const parsedWarningByCall = new Map<string, string>();
        if (parseAssistantOutput && toolCallsMap.size === 0) {
          const allowed = new Set<string>();
          // Allow only tools that are actually exposed to the model for this request.
          for (const t of toolsForModelEffective as any[]) {
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

        const toolCalls = Array.from(toolCallsMap.values())
          .filter(isToolCall)
          .filter((c) => c.name && c.name.trim());
        toolCalls.sort((a, b) => (a.index ?? 999999) - (b.index ?? 999999));

        // Persist assistant message (even if empty; it anchors tool blocks).
        await persistAssistantText({ store, sessionId, text: assistantText, toolCallsForTranscript: toolCalls });

        // Close the current assistant streaming phase in the UI.
        if (streamMode === "full") send(res, "assistant_end", {});

        if (toolCalls.length === 0) {
          // No tool calls: final answer.
          if (streamMode === "final") send(res, "final", { text: assistantText });
          break;
        }

        // Append the provider-specific assistant tool-call message to the upstream transcript.
        upstreamMessages.push(backend.provider.buildAssistantToolCallMessage({ assistantText, toolCalls }));

        const { toolMessages } = await runToolCalls({
          store,
          approvals,
          sessionId,
          rootDir,
          provider: backend.provider,
          mcpExec,
          nameToMcpTool,
          toolCalls,
          enabledToolSet,
          toolAccessMode,
          execAllowlist,
          requestedOrigin,
          patchedOrigin: metaPatch.origin,
          storedOrigin: priorMeta.origin,
          config,
          rawConfig: raw,
          parseWarningByCall: parsedWarningByCall,
          emit: (event, data) => {
            if (streamMode === "full") send(res, event, data);
          },
          isCancelled: () => clientClosed
        });

        upstreamMessages.push(...toolMessages);

        // Start a fresh assistant streaming phase (the model's post-tool response).
        if (streamMode === "full") send(res, "assistant_start", { messageId: crypto.randomUUID() });
      }

      // Mark end of a logical user-turn (even if it involved tool loops).
      await store.appendTurn(
        sessionId,
        buildTurnMeta({
          usedTokens,
          upstreamModel: backend.upstreamModel,
          upstreamBaseUrl: backend.provider.origin.baseUrl ?? backend.provider.origin.adapter
        }),
        Date.now()
      );

      await store.updateMeta(sessionId, {
        ...metaPatch,
        updatedAt: Date.now(),
        lastModel: canonicalRouteModel || backend.upstreamModel
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
          lastModel: canonicalRouteModel || backend.upstreamModel
        });
        return;
      }

      // Persist an assistant-visible error so the UI doesn't "flash then disappear" after re-sync.
      await persistAssistantError({ store, sessionId, message: msg });

      // Still close the turn so UI can collapse it.
      await store.appendTurn(
        sessionId,
        buildTurnMeta({
          usedTokens,
          upstreamModel: backend.upstreamModel,
          upstreamBaseUrl: backend.provider.origin.baseUrl ?? backend.provider.origin.adapter
        }),
        Date.now()
      );
      await store.updateMeta(sessionId, { ...metaPatch, updatedAt: Date.now(), lastModel: canonicalRouteModel || backend.upstreamModel });

      if (!res.writableEnded) {
        send(res, "error", { message: msg });
        send(res, "done", {});
        stopKeepAlive();
        res.end();
      }
    }
  });
}
