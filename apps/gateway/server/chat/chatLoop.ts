/**
 * Chat tool-calling loop.
 *
 * Extracted from the monolithic chat.ts handler so it mirrors the shape of
 * computerUseLoop.ts and can be swapped via operationMode.
 *
 * Lifecycle:
 *   1. Stream a model turn (via provider.streamTurn)
 *   2. If tool calls present → execute tools → append results → go to 1
 *   3. If no tool calls → done
 */

import crypto from "node:crypto";

import type { EcliaConfig } from "@eclia/config";
import type { SessionStore } from "../sessionStore.js";
import type { ToolApprovalHub } from "../tools/approvalHub.js";
import type { ToolAccessMode, BashAllowlistRule } from "../tools/policy.js";
import type { McpStdioClient } from "../mcp/stdioClient.js";
import type { UpstreamProvider, ToolCall, UpstreamRequestDebugCapture } from "../upstream/provider.js";
import type { SessionMetaV1 } from "../sessionTypes.js";
import { setActiveRequest } from "../activeRequests.js";
import { runToolCalls } from "./toolExecutor.js";
import { parseAssistantToolCallsFromText } from "../tools/assistantOutputParse.js";
import { appendSessionWarning } from "../debug/warnings.js";

// ── Types ────────────────────────────────────────────────────────────

export type ChatLoopArgs = {
  provider: UpstreamProvider;
  headers: Record<string, string>;
  /** Mutable — the loop appends assistant + tool messages as it progresses. */
  messages: any[];
  tools: any[];

  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;

  // Tool execution deps
  store: SessionStore;
  approvals: ToolApprovalHub;
  sessionId: string;
  rootDir: string;

  mcpBash: McpStdioClient;
  nameToMcpTool: (name: string) => string;

  enabledToolSet: Set<string> | null;
  toolAccessMode: ToolAccessMode;
  bashAllowlist: BashAllowlistRule[];

  requestedOrigin: SessionMetaV1["origin"] | undefined;
  patchedOrigin: SessionMetaV1["origin"] | undefined;
  storedOrigin: SessionMetaV1["origin"] | undefined;

  config: EcliaConfig;
  rawConfig?: any;

  /** When true, attempt to parse tool calls from assistant plaintext (fallback). */
  parseAssistantOutput: boolean;

  /** Stream mode: "full" emits deltas + tool events, "final" emits only the final text. */
  streamMode: "full" | "final";

  signal: AbortSignal;
  emit: (event: string, data: any) => void;
  isCancelled: () => boolean;

  debug?: Omit<UpstreamRequestDebugCapture, "seq">;
  captureUpstream: boolean;
};

export type ChatLoopResult = {
  /** Final assistant text from the last model turn. */
  assistantText: string;
  /** Number of model turns executed (including tool-loop iterations). */
  iterations: number;
  stopReason: "completed" | "cancelled";
};

// ── Helpers ──────────────────────────────────────────────────────────

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
  const ts = Date.now();
  const tc = Array.isArray(args.toolCallsForTranscript) ? args.toolCallsForTranscript : [];
  const tool_calls = tc
    .filter((c) => c && typeof c.callId === "string" && typeof c.name === "string" && typeof c.argsRaw === "string")
    .map((c) => ({
      id: c.callId,
      type: "function" as const,
      function: { name: c.name, arguments: c.argsRaw }
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

// ── Main loop ────────────────────────────────────────────────────────

export async function runChatLoop(args: ChatLoopArgs): Promise<ChatLoopResult> {
  const {
    provider, headers, messages, tools,
    temperature, topP, topK, maxOutputTokens,
    store, approvals, sessionId, rootDir,
    mcpBash, nameToMcpTool,
    enabledToolSet, toolAccessMode, bashAllowlist,
    requestedOrigin, patchedOrigin, storedOrigin,
    config, rawConfig,
    parseAssistantOutput, streamMode,
    signal, emit, isCancelled,
    debug, captureUpstream
  } = args;

  const origin = provider.origin;
  let iterations = 0;
  let assistantText = "";
  let debugSeq = 0;

  while (!isCancelled()) {
    // Phase: generating
    if (streamMode === "full") emit("phase", { phase: "generating" });
    setActiveRequest(sessionId, "generating");

    const turn = await provider.streamTurn({
      headers,
      messages,
      signal,
      tools,
      temperature: temperature ?? undefined,
      topP: topP ?? undefined,
      topK: topK ?? undefined,
      maxOutputTokens: maxOutputTokens ?? undefined,
      onDelta: (text) => {
        if (streamMode === "full") emit("delta", { text });
      },
      debug: captureUpstream && debug ? { ...debug, seq: ++debugSeq } : undefined
    });

    assistantText = turn.assistantText;
    let toolCallsMap = turn.toolCalls;
    iterations++;

    // ── Fallback: parse tool calls from plaintext ────────────────
    const parsedWarningByCall = new Map<string, string>();
    if (parseAssistantOutput && toolCallsMap.size === 0) {
      const allowed = new Set<string>();
      for (const t of tools as any[]) {
        const n = typeof t?.function?.name === "string" ? t.function.name : typeof t?.name === "string" ? t.name : "";
        if (n) allowed.add(n);
      }

      const parsed = parseAssistantToolCallsFromText(assistantText, allowed);
      if (parsed.length) {
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
              upstreamModel: provider.upstreamModel,
              tool: row.call.name,
              callId: row.call.callId,
              line: row.line
            }
          });
        }

        console.warn(
          `[gateway] Parsed ${parsed.length} tool call(s) from assistant plaintext output (provider=${origin.vendor} model=${provider.upstreamModel}).`
        );
      }
    }

    if (turn.finishReason === "tool_calls" && toolCallsMap.size === 0) {
      console.warn(
        `[gateway] finish_reason=tool_calls but parsed 0 tool calls (provider=${origin.vendor} model=${provider.upstreamModel})`
      );
    }

    const toolCalls = Array.from(toolCallsMap.values())
      .filter(isToolCall)
      .filter((c) => c.name && c.name.trim());
    toolCalls.sort((a, b) => (a.index ?? 999999) - (b.index ?? 999999));

    // Persist assistant message (even if empty; it anchors tool blocks).
    await persistAssistantText({ store, sessionId, text: assistantText, toolCallsForTranscript: toolCalls });

    // Close the current assistant streaming phase in the UI.
    if (streamMode === "full") emit("assistant_end", {});

    if (toolCalls.length === 0) {
      // No tool calls: final answer.
      if (streamMode === "final") emit("final", { text: assistantText });
      return { assistantText, iterations, stopReason: "completed" };
    }

    // Append the provider-specific assistant tool-call message to the upstream transcript.
    messages.push(provider.buildAssistantToolCallMessage({ assistantText, toolCalls }));

    // Phase: tool_executing
    if (streamMode === "full") {
      const toolNames = toolCalls.map((c) => c.name);
      emit("phase", { phase: "tool_executing", tools: toolNames });
    }
    setActiveRequest(sessionId, "tool_executing");

    const { toolMessages } = await runToolCalls({
      store,
      approvals,
      sessionId,
      rootDir,
      provider,
      mcpBash,
      nameToMcpTool,
      toolCalls,
      enabledToolSet,
      toolAccessMode,
      bashAllowlist,
      requestedOrigin,
      patchedOrigin,
      storedOrigin,
      config,
      rawConfig,
      parseWarningByCall: parsedWarningByCall,
      emit: (event, data) => {
        if (streamMode === "full") emit(event, data);
      },
      isCancelled
    });

    messages.push(...toolMessages);

    // Start a fresh assistant streaming phase (the model's post-tool response).
    if (streamMode === "full") emit("assistant_start", { messageId: crypto.randomUUID() });
  }

  return { assistantText, iterations, stopReason: "cancelled" };
}
