import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";

import {
  canonicalizeRouteKeyForConfig,
  joinUrl,
  loadEcliaConfig,
  renderSystemInstructionTemplate,
  readSystemMemoryTemplate,
  renderSystemMemoryTemplate
} from "@eclia/config";

import { SessionStore } from "../sessionStore.js";
import type { SessionMetaV1 } from "../sessionTypes.js";
import type { OpenAICompatMessage } from "../transcriptTypes.js";
import { ToolApprovalHub } from "../tools/approvalHub.js";
import { loadBashAllowlist, type ToolAccessMode } from "../tools/policy.js";
import { MEMORY_TOOL_NAME } from "../tools/toolSchemas.js";
import { McpStdioClient } from "../mcp/stdioClient.js";
import { sseHeaders, initSse, send, startSseKeepAlive } from "../sse.js";
import { withSessionLock } from "../sessionLock.js";
import { resolveUpstreamBackend } from "../upstream/resolve.js";
import { json, readJson } from "@eclia/gateway-client/utils";
import { safeInt } from "../httpUtils.js";
import { composeSystemInstruction } from "../instructions/systemInstruction.js";
import { buildSkillsInstructionPart } from "../instructions/skillsInstruction.js";
import { readGitInfo } from "../gitInfo.js";

import { fetchMemoryProfile } from "../memoryClient.js";
import { setActiveRequest, clearActiveRequest } from "../activeRequests.js";

import {
  deriveTitle,
  deriveTitleFromOrigin,
  extractRequestedOrigin,
  transcriptRecordsToMessages
} from "../chat/sessionUtils.js";
import { runChatLoop } from "../chat/chatLoop.js";
import { runComputerUseLoop } from "../computerUse/computerUseLoop.js";

type ChatReqBody = {
  sessionId?: string;
  model?: string; // UI route key OR a real upstream model id
  userText?: string;

  /** Optional override for the upstream system instruction (bypasses the gateway default system prompt + skills injection). */
  systemInstructionOverride?: string;

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
   * - safe: auto-run allowlisted bash commands only; otherwise require user approval.
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
   * Whether to include prior session history in the upstream context.
   *
   * Default: true.
   * When false, the gateway will still persist transcript records to the session,
   * but will build context using ONLY the current user message (system instruction
   * is still injected).
   */
  includeHistory?: boolean;

  /** When true, skip the gateway's built-in memory recall/injection for this request. */
  skipMemoryRecall?: boolean;

  /**
   * Optional session origin metadata.
   * If the session has no origin yet, the gateway will persist it.
   */
  origin?: { kind: string; [k: string]: unknown };

  /**
   * Optional explicit context messages (role-structured).
   * If provided, these messages will be used to build the upstream context instead of the stored session history.
   * The messages are NOT persisted to the session transcript (only the current userText is).
   */
  messages?: Array<{ role: "system" | "user" | "assistant" | "tool"; content: any }>;

  /**
   * Operation mode.
   * - "chat" (default): normal tool-calling chat loop.
   * - "computer_use": screenshot → model → execute actions loop (Responses API).
   */
  operationMode?: "chat" | "computer_use";

  /** When true (and `messages` is provided), use the messages array as-is — no system prompt, no memory, no userMsg append. */
  rawMode?: boolean;

  /** Computer use: logical display width declared to the model (default 1280). */
  displayWidth?: number;
  /** Computer use: logical display height declared to the model (default 800). */
  displayHeight?: number;
  /** Computer use: max iterations before forced stop (default 30). */
  computerUseMaxIterations?: number;
  /** Computer use: post-action delay in ms (default 500). */
  computerUseActionDelayMs?: number;
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

function contentToString(v: any): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function coerceExplicitContextMessages(raw: any): OpenAICompatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: OpenAICompatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const role = typeof (m as any).role === "string" ? String((m as any).role) : "";
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") continue;

    const content = contentToString((m as any).content);
    const msg: any = { role, content };

    if (role === "tool") {
      const tci = typeof (m as any).tool_call_id === "string" ? String((m as any).tool_call_id) : "";
      if (tci) msg.tool_call_id = tci;
    } else {
      const name = typeof (m as any).name === "string" ? String((m as any).name) : "";
      if (name) msg.name = name;
    }

    out.push(msg as OpenAICompatMessage);
  }
  return out.length ? out : [];
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
  const mcpBash = toolhost.mcp;
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
  const rawMode = Boolean(body.rawMode) && Array.isArray(body.messages);

  if (!rawMode && !userText.trim()) {
    return json(res, 400, { ok: false, error: "empty_message" });
  }

  const toolAccessMode: ToolAccessMode = body.toolAccessMode === "safe" ? "safe" : "full";
  const streamMode: "full" | "final" = body.streamMode === "final" ? "final" : "full";
  const operationMode: "chat" | "computer_use" = body.operationMode === "computer_use" ? "computer_use" : "chat";
  const includeHistory = body.includeHistory !== false;
  const requestedOrigin = extractRequestedOrigin(body);

  // Per-request override (used by Symphony nodes, memory extraction, etc.).
  // Falls back to config.tools.enabled when omitted.
  const enabledToolsOverride = Array.isArray(body.enabledTools)
    ? body.enabledTools.map((x: any) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
    : null;

  return await withSessionLock(sessionId, async () => {
    // If the client disconnected while waiting in the per-session queue, don't do work.
    if ((req as any).aborted || (req.socket as any)?.destroyed || res.writableEnded) return;

    const { config, raw, rootDir } = loadEcliaConfig(process.cwd());

    // Per-request override takes precedence; otherwise use TOML config default.
    const enabledToolSet = new Set<string>(
      enabledToolsOverride ?? (Array.isArray((config as any).tools?.enabled) ? (config as any).tools.enabled : [])
    );
    const memoryEnabled = Boolean((config as any)?.memory?.enabled);

    const toolsForModelEffective = (toolsForModel as any[]).filter((t) => {
      const n =
        typeof (t as any)?.function?.name === "string"
          ? String((t as any).function.name)
          : typeof (t as any)?.name === "string"
            ? String((t as any).name)
            : "";
      if (!n) return false;
      if (n === MEMORY_TOOL_NAME && !memoryEnabled) return false;
      return enabledToolSet.has(n);
    });
    const canonicalRouteModel = canonicalizeRouteKeyForConfig(routeModel, config);

    // Best-effort provenance snapshot (commit/branch/dirty).
    const git = readGitInfo(rootDir);

    // System instruction: by default, it is composed from _system(.local).md + skills.
    // When systemInstructionOverride is provided, we bypass the default composition entirely.
    const systemInstructionOverrideRaw = typeof body.systemInstructionOverride === "string" ? String(body.systemInstructionOverride) : "";
    const systemInstruction = systemInstructionOverrideRaw.trim().length
      ? renderSystemInstructionTemplate(systemInstructionOverrideRaw, {
          userPreferredName: (config as any)?.persona?.user_preferred_name,
          assistantName: (config as any)?.persona?.assistant_name
        })
      : composeSystemInstruction([
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
        ]).text;

    // Ensure store is initialized and session exists.
    await store.init();

    let priorMeta!: SessionMetaV1;
    let priorMessages: OpenAICompatMessage[] = [];
    const metaPatch: Partial<SessionMetaV1> = {};

    try {
      const existing = rawMode
        ? null  // rawMode doesn't use session history — skip the full transcript load
        : await store.readTranscript(sessionId);
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
    // - Adapter origin behavior: prefer adapter-provided title formatting.
    const titleOrigin = requestedOrigin ?? priorMeta.origin;
    const originTitle = deriveTitleFromOrigin(titleOrigin);
    const hasDefaultTitle = priorMeta.title === "New session" || !priorMeta.title.trim();

    if (priorMessages.length === 0 && hasDefaultTitle) {
      metaPatch.title = originTitle ?? deriveTitle(userText);
    } else if (originTitle && hasDefaultTitle) metaPatch.title = originTitle;

    // Persist the user message first (so the session survives even if upstream fails).
    const userTs = Date.now();
    if (!rawMode) {
      await store.appendTranscript(sessionId, { role: "user", content: userText } as any, userTs);
    }

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

    const buildTurnMeta = (args: { usedTokens: number; upstreamModel?: string; upstreamBaseUrl?: string; providerKind?: string }) => {
      const baseUrl = String(args.upstreamBaseUrl ?? "");
      return {
        turnId,
        tokenLimit,
        usedTokens: args.usedTokens,
        upstream: {
          routeKey: canonicalRouteModel,
          model: String(args.upstreamModel ?? canonicalRouteModel),
          baseUrl,
          ...(args.providerKind ? { providerKind: args.providerKind } : {})
        },
        git,
        runtime: runtimeForTurn,
        toolAccessMode,
        operationMode,
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
          upstreamBaseUrl: backend.provider.origin.baseUrl ?? backend.provider.origin.adapter,
          providerKind: backend.provider.kind
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

    const explicitContextMessages = coerceExplicitContextMessages((body as any).messages);

    // Start SSE early so we can emit phase events during recall.
    const { stopKeepAlive } = beginSse(res);

    // --- Raw mode: user-supplied messages are used as-is (no system prompt, no memory, no userMsg append) ---
    let historyForContext: OpenAICompatMessage[];

    if (rawMode && explicitContextMessages) {
      historyForContext = explicitContextMessages;
    } else {
      const userMsg: OpenAICompatMessage = { role: "user", content: userText } as any;
      const explicitNonSystem = explicitContextMessages ? explicitContextMessages.filter((m) => m && m.role !== "system") : null;

      const historyBase = (explicitNonSystem
        ? [...explicitNonSystem, userMsg]
        : includeHistory
          ? [...priorMessages, userMsg]
          : [userMsg]
      ).filter((m) => m && m.role !== "system");

      const skipMemoryRecall = Boolean(body.skipMemoryRecall);

      // Optional: fetch memory profile and append to system instruction (best-effort).
      let memoryProfileText = "";
      if (!skipMemoryRecall) {
        try {
          const profile = await fetchMemoryProfile({ config });
          if (profile) memoryProfileText = profile;
        } catch {
          // best-effort: profile fetch failures should never block chat
        }
      }

      // Compose full system instruction: base + memory profile (via template).
      let fullSystemInstruction = systemInstruction;
      if (memoryProfileText) {
        const { text: memTpl } = readSystemMemoryTemplate(rootDir);
        if (memTpl.trim()) {
          const rendered = renderSystemMemoryTemplate(memTpl, {
            memoryProfile: memoryProfileText,
            userPreferredName: (config as any)?.persona?.user_preferred_name,
            assistantName: (config as any)?.persona?.assistant_name
          });
          fullSystemInstruction = `${systemInstruction}\n\n${rendered}`;
        }
      }

      // Inject system instruction as the only system message (when configured).
      historyForContext = fullSystemInstruction.trim().length
        ? [
            ...historyBase,
            ({ role: "system", content: fullSystemInstruction } as any)
          ]
        : historyBase;
    }

    const { messages: contextMessages, usedTokens, dropped } = backend.provider.buildContext(historyForContext, tokenLimit);

    // NOTE: keep meta minimal; turn-level stats are persisted in transcript.ndjson.
    send(res, "meta", { sessionId, model: routeModel, usedTokens });

    console.log(
      `[gateway] POST /api/chat  session=${sessionId} model=${backend.upstreamModel} ctx≈${usedTokens} tools=${toolsForModelEffective.length ? "on" : "off"} mode=${toolAccessMode}`
    );

    const bashAllowlist = loadBashAllowlist(raw);

    const upstreamAbort = new AbortController();
    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
      upstreamAbort.abort();
      approvals.cancelSession(sessionId);
    });

    const captureUpstreamRequests = Boolean((config as any)?.debug?.capture_upstream_requests);

    // Capture dumps should live alongside the session store under <repo>/.eclia/debug/<sessionId>/.
    // Derive <repo> from the store path rather than process.cwd()/config discovery to avoid surprises.
    const debugRootDir = path.dirname(path.dirname(store.sessionsDir));

    // We build the upstream transcript progressively so tool results are fed back correctly.
    const upstreamMessages: any[] = [...contextMessages];


    try {
      if (operationMode === "computer_use") {
        const responsesUrl = joinUrl(
          backend.provider.origin.baseUrl ?? "",
          "/responses"
        );

        await runComputerUseLoop({
          url: responsesUrl,
          headers,
          model: backend.upstreamModel,
          instructions: systemInstruction,
          userText,
          maxIterations: clampOptionalInt(body.computerUseMaxIterations, 1, 200) ?? 30,
          actionDelayMs: clampOptionalInt(body.computerUseActionDelayMs, 0, 10_000) ?? 500,
          signal: upstreamAbort.signal,
          emit: (event, data) => send(res, event, data),
          isCancelled: () => clientClosed,
          debug: captureUpstreamRequests ? { rootDir: debugRootDir, sessionId, seq: 0 } : undefined,
          sessionDir: path.join(debugRootDir, ".eclia", "sessions", sessionId),
          store,
          sessionId
        });
      } else {
        await runChatLoop({
          provider: backend.provider,
          headers,
          messages: upstreamMessages,
          tools: toolsForModelEffective,
          temperature: temperature ?? undefined,
          topP: topP ?? undefined,
          topK: topK ?? undefined,
          maxOutputTokens: maxOutputTokens ?? undefined,
          store,
          approvals,
          sessionId,
          rootDir,
          mcpBash,
          nameToMcpTool,
          enabledToolSet,
          toolAccessMode,
          bashAllowlist,
          requestedOrigin,
          patchedOrigin: metaPatch.origin,
          storedOrigin: priorMeta.origin,
          config,
          rawConfig: raw,
          parseAssistantOutput: Boolean((config as any)?.debug?.parse_assistant_output),
          streamMode,
          signal: upstreamAbort.signal,
          emit: (event, data) => send(res, event, data),
          isCancelled: () => clientClosed,
          debug: captureUpstreamRequests ? { rootDir: debugRootDir, sessionId } : undefined,
          captureUpstream: captureUpstreamRequests
        });
      }

      // Mark end of a logical user-turn (even if it involved tool loops).
      await store.appendTurn(
        sessionId,
        buildTurnMeta({
          usedTokens,
          upstreamModel: backend.upstreamModel,
          upstreamBaseUrl: backend.provider.origin.baseUrl ?? backend.provider.origin.adapter,
          providerKind: backend.provider.kind
        }),
        Date.now()
      );

      await store.updateMeta(sessionId, {
        ...metaPatch,
        updatedAt: Date.now(),
        lastModel: canonicalRouteModel || backend.upstreamModel
      });

      clearActiveRequest(sessionId);

      if (!res.writableEnded) {
        send(res, "done", {});
        stopKeepAlive();
        res.end();
      }
    } catch (e: any) {
      clearActiveRequest(sessionId);
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
          upstreamBaseUrl: backend.provider.origin.baseUrl ?? backend.provider.origin.adapter,
          providerKind: backend.provider.kind
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
