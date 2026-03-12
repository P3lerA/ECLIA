/**
 * OpenAI Responses API streaming client.
 *
 * Wire format: POST /v1/responses with named SSE events.
 * This is structurally different from Chat Completions (/v1/chat/completions):
 *   - Request uses `input` (typed items) instead of `messages`.
 *   - Streaming uses named `event:` lines (response.output_text.delta, etc.)
 *     instead of flat `data:` chunks with choices[].delta.
 *   - Tool calls are separate output items (function_call) rather than
 *     embedded in an assistant message.
 *   - Computer use returns computer_call items (handled in a future iteration).
 */

import { dumpUpstreamRequestBody } from "../debug/upstreamRequests.js";
import type { UpstreamRequestDebugCapture } from "./provider.js";

function safeText(v: any): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * Parse SSE blocks from the Responses API.
 *
 * Unlike Chat Completions (data-only), the Responses API emits named events:
 *
 *     event: response.output_text.delta
 *     data: {"type":"response.output_text.delta","delta":"Hello",...}
 *
 * We extract both the event name and data payload per block.
 */
function parseSSE(input: string): { blocks: Array<{ event: string; data: string }>; rest: string } {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";

  const blocks: Array<{ event: string; data: string }> = [];
  for (const part of parts) {
    const lines = part.split("\n").filter(Boolean);
    let event = "";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
    }
    if (dataLines.length || event) {
      blocks.push({ event, data: dataLines.join("\n") });
    }
  }
  return { blocks, rest };
}

type FunctionCallAccum = {
  itemId: string;
  callId: string;
  name: string;
  argsRaw: string;
  outputIndex: number;
};

export type ComputerCallAccum = {
  callId: string;
  actions: Array<Record<string, any>>;
  pendingSafetyChecks: Array<{ id: string; code: string; message: string }>;
};

export type UpstreamTurnResult = {
  assistantText: string;
  toolCalls: Map<string, { callId: string; index?: number; name: string; argsRaw: string }>;
  computerCall?: ComputerCallAccum;
  finishReason: string | null;
  /** The upstream response ID — used for `previous_response_id` chaining. */
  responseId?: string;
};

export async function streamOpenAIResponsesTurn(args: {
  url: string;
  headers: Record<string, string>;
  model: string;
  instructions?: string;
  input: any[];
  tools?: any[];
  signal: AbortSignal;
  /** Optional sampling temperature override. */
  temperature?: number;
  /** Optional nucleus sampling override (top_p). */
  topP?: number;
  /** Optional output token limit override (max_output_tokens). */
  maxOutputTokens?: number;
  /** Enable truncation (recommended for computer use loops). */
  truncation?: "auto" | "disabled";
  /** Chain to a previous response instead of resending full history. */
  previousResponseId?: string;
  onDelta: (text: string) => void;
  debug?: UpstreamRequestDebugCapture;
}): Promise<UpstreamTurnResult> {
  // When using previous_response_id chaining (computer use loops), the upstream
  // must persist responses (store: true) so subsequent turns can reference them.
  const needsStore = Boolean(args.previousResponseId) || Boolean(args.truncation);

  const requestBody: any = {
    model: args.model,
    stream: true,
    store: needsStore,
    input: args.input
  };

  if (typeof args.instructions === "string" && args.instructions.trim()) {
    requestBody.instructions = args.instructions;
  }

  if (Array.isArray(args.tools) && args.tools.length) {
    requestBody.tools = args.tools;
    requestBody.tool_choice = "auto";
  }

  if (args.truncation) {
    requestBody.truncation = args.truncation;
  }

  if (args.previousResponseId) {
    requestBody.previous_response_id = args.previousResponseId;
  }

  if (typeof args.temperature === "number" && Number.isFinite(args.temperature)) {
    requestBody.temperature = Math.max(0, Math.min(2, args.temperature));
  }

  if (typeof args.topP === "number" && Number.isFinite(args.topP)) {
    requestBody.top_p = Math.max(0, Math.min(1, args.topP));
  }

  const maxOut =
    typeof args.maxOutputTokens === "number" && Number.isFinite(args.maxOutputTokens)
      ? Math.max(1, Math.min(200_000, Math.trunc(args.maxOutputTokens)))
      : null;
  if (maxOut !== null) requestBody.max_output_tokens = maxOut;

  if (args.debug) {
    dumpUpstreamRequestBody({
      rootDir: args.debug.rootDir,
      sessionId: args.debug.sessionId,
      seq: args.debug.seq,
      providerKind: "openai_responses",
      upstreamModel: args.model,
      url: args.url,
      body: requestBody
    });
  }

  const upstream = await fetch(args.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...args.headers
    },
    body: JSON.stringify(requestBody),
    signal: args.signal
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    let detail = "";
    try {
      const j = JSON.parse(text);
      detail = safeText(j?.error?.message ?? j?.message);
    } catch {
      // ignore
    }
    throw new Error(
      `Upstream error: ${upstream.status} ${upstream.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let assistantText = "";
  let finishReason: string | null = null;
  let responseId: string | undefined;

  // Track function calls by item id (fc_xxx) during streaming,
  // then finalize into toolCalls keyed by call_id.
  const fcByItemId = new Map<string, FunctionCallAccum>();
  const toolCalls = new Map<string, { callId: string; index?: number; name: string; argsRaw: string }>();
  let computerCall: ComputerCallAccum | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const { blocks, rest } = parseSSE(buffer);
    buffer = rest;

    for (const b of blocks) {
      const data = b.data.trim();
      if (!data) continue;

      let parsed: any = null;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      const type = safeText(parsed?.type);

      // ── Response created — capture response ID ───────────────────
      if (type === "response.created") {
        const id = safeText(parsed?.response?.id);
        if (id) responseId = id;
        continue;
      }

      // ── Text streaming ────────────────────────────────────────────
      if (type === "response.output_text.delta") {
        const delta = safeText(parsed?.delta);
        if (delta) {
          assistantText += delta;
          args.onDelta(delta);
        }
        continue;
      }

      // ── Function call: new item ───────────────────────────────────
      if (type === "response.output_item.added") {
        const item = parsed?.item;
        if (item?.type === "function_call") {
          const itemId = safeText(item.id);
          const callId = safeText(item.call_id);
          const name = safeText(item.name);
          const outputIndex = typeof parsed?.output_index === "number" ? parsed.output_index : 0;

          if (itemId) {
            fcByItemId.set(itemId, { itemId, callId, name, argsRaw: "", outputIndex });
          }
        }
        // ── Computer call: new item ─────────────────────────────────
        if (item?.type === "computer_call") {
          const callId = safeText(item.call_id);
          const action = item.action;
          const actions = Array.isArray(item.actions)
            ? item.actions
            : action && typeof action === "object"
              ? [action]
              : [];
          const pending = Array.isArray(item.pending_safety_checks) ? item.pending_safety_checks : [];

          if (callId) {
            computerCall = { callId, actions, pendingSafetyChecks: pending };
          }
        }
        continue;
      }

      // ── Function call: arguments delta ────────────────────────────
      if (type === "response.function_call_arguments.delta") {
        const itemId = safeText(parsed?.item_id);
        const delta = safeText(parsed?.delta);
        const acc = fcByItemId.get(itemId);
        if (acc && delta) acc.argsRaw += delta;
        continue;
      }

      // ── Function call: arguments done ─────────────────────────────
      if (type === "response.function_call_arguments.done") {
        const itemId = safeText(parsed?.item_id);
        const finalArgs = safeText(parsed?.arguments);
        const acc = fcByItemId.get(itemId);
        if (acc) acc.argsRaw = finalArgs || acc.argsRaw;
        continue;
      }

      // ── Output item done (finalize function calls) ────────────────
      if (type === "response.output_item.done") {
        const item = parsed?.item;
        if (item?.type === "function_call") {
          const itemId = safeText(item.id);
          const acc = fcByItemId.get(itemId);

          const callId = safeText(item.call_id) || acc?.callId || "";
          const name = safeText(item.name) || acc?.name || "";
          const argsRaw = safeText(item.arguments) || acc?.argsRaw || "{}";
          const outputIndex = acc?.outputIndex;

          if (callId) {
            toolCalls.set(callId, { callId, index: outputIndex, name, argsRaw });
          }
        }
        if (item?.type === "computer_call") {
          const callId = safeText(item.call_id);
          const action = item.action;
          const actions = Array.isArray(item.actions)
            ? item.actions
            : action && typeof action === "object"
              ? [action]
              : computerCall?.actions ?? [];
          const pending = Array.isArray(item.pending_safety_checks)
            ? item.pending_safety_checks
            : computerCall?.pendingSafetyChecks ?? [];

          if (callId) {
            computerCall = { callId, actions, pendingSafetyChecks: pending };
          }
        }
        continue;
      }

      // ── Response completed ────────────────────────────────────────
      if (type === "response.completed") {
        if (computerCall) {
          finishReason = "computer_call";
        } else if (toolCalls.size > 0) {
          finishReason = "tool_calls";
        } else {
          finishReason = "stop";
        }

        return { assistantText, toolCalls, computerCall, finishReason, responseId };
      }

      // ── Response incomplete (token limit / content filter) ─────
      if (type === "response.incomplete") {
        const reason = safeText(parsed?.response?.incomplete_details?.reason);

        // Content filter — abort regardless of accumulated output.
        if (reason === "content_filter") {
          throw new Error("Upstream terminated response: content filter triggered");
        }

        // max_output_tokens — if a complete computer_call or tool_calls were
        // streamed before the cutoff, they're still valid and actionable.
        finishReason = computerCall ? "computer_call" : toolCalls.size > 0 ? "tool_calls" : "length";
        return { assistantText, toolCalls, computerCall, finishReason, responseId };
      }

      // ── Response failed ───────────────────────────────────────────
      if (type === "response.failed") {
        const errMsg =
          safeText(parsed?.response?.error?.message) || "Unknown Responses API error";
        throw new Error(`Upstream stream error: ${errMsg.slice(0, 300)}`);
      }

      // All other events (response.created, response.in_progress,
      // response.content_part.added/done, response.reasoning_*, etc.)
      // are informational — ignore for now.
    }
  }

  // Stream ended without response.completed (unexpected but handle gracefully).
  if (computerCall) finishReason = "computer_call";
  else if (toolCalls.size > 0) finishReason = "tool_calls";
  return { assistantText, toolCalls, computerCall, finishReason, responseId };
}