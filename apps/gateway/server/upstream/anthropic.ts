import { dumpUpstreamRequestBody } from "../debug/upstreamRequests.js";

import type { ToolCall, UpstreamRequestDebugCapture } from "./provider.js";

function safeText(v: any): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

function mergePossiblyCumulative(prev: string, nextChunk: string): string {
  if (!nextChunk) return prev;
  if (!prev) return nextChunk;

  // Some Anthropic-compatible providers stream cumulative strings (full value so far)
  // rather than incremental deltas.
  if (nextChunk.length > prev.length && nextChunk.startsWith(prev)) return nextChunk;

  return prev + nextChunk;
}

function extractAnthropicErrorText(bodyText: string): string {
  if (!bodyText) return "";
  try {
    const parsed = JSON.parse(bodyText);
    const msg =
      typeof parsed?.error?.message === "string"
        ? parsed.error.message
        : typeof parsed?.message === "string"
          ? parsed.message
          : "";
    return msg ? safeText(msg) : "";
  } catch {
    return "";
  }
}

/**
 * Parse SSE blocks (data: lines). Intentionally minimal.
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

type ToolUseAccum = {
  callId: string;
  index: number;
  name: string;
  /** JSON from content_block_start when provider eagerly includes tool_use.input. */
  startArgsRaw: string;
  /** Accumulated partial JSON string from input_json_delta events. */
  deltaArgsRaw: string;
};

export type UpstreamTurnResult = {
  assistantText: string;
  toolCalls: Map<string, ToolCall>;
  finishReason: string | null;
};

export async function streamAnthropicTurn(args: {
  url: string;
  headers: Record<string, string>;
  anthropicVersion: string;
  model: string;
  system?: string;
  messages: any[];
  tools?: any[];
  toolChoice?: any;
  signal: AbortSignal;
  /** Optional sampling temperature override. */
  temperature?: number;
  /** Optional nucleus sampling override (top_p). */
  topP?: number;
  /** Optional top-k sampling override (top_k). */
  topK?: number;
  /** Optional output token limit override (max_tokens). */
  maxOutputTokens?: number;
  onDelta: (text: string) => void;
  debug?: UpstreamRequestDebugCapture;
}): Promise<UpstreamTurnResult> {
  const postJson = async (body: any): Promise<Response> => {
    if (args.debug) {
      dumpUpstreamRequestBody({
        rootDir: args.debug.rootDir,
        sessionId: args.debug.sessionId,
        seq: args.debug.seq,
        providerKind: "anthropic",
        upstreamModel: args.model,
        url: args.url,
        body
      });
    }

    return await fetch(args.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "anthropic-version": args.anthropicVersion,
        ...args.headers
      },
      body: JSON.stringify(body),
      signal: args.signal
    });
  };

  const maxOut = typeof args.maxOutputTokens === "number" && Number.isFinite(args.maxOutputTokens) ? Math.trunc(args.maxOutputTokens) : null;

  const requestBodyBase: any = {
    model: args.model,
    max_tokens: maxOut && maxOut > 0 ? maxOut : 1024,
    stream: true,
    messages: args.messages
  };

  if (typeof args.system === "string" && args.system.trim()) requestBodyBase.system = args.system;
  if (Array.isArray(args.tools) && args.tools.length) requestBodyBase.tools = args.tools;
  if (args.toolChoice && typeof args.toolChoice === "object") requestBodyBase.tool_choice = args.toolChoice;
  if (typeof args.temperature === "number" && Number.isFinite(args.temperature)) requestBodyBase.temperature = args.temperature;
  if (typeof args.topP === "number" && Number.isFinite(args.topP)) requestBodyBase.top_p = args.topP;
  if (typeof args.topK === "number" && Number.isFinite(args.topK)) requestBodyBase.top_k = Math.trunc(args.topK);

  let upstream = await postJson(requestBodyBase);

  // Some Anthropic-compatible providers reject vendor extensions (e.g. top_k).
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    const msg = extractAnthropicErrorText(text);

    const candidates: any[] = [];

    if (Object.prototype.hasOwnProperty.call(requestBodyBase, "top_k")) {
      if (!msg || /top_k|unknown|unrecognized|unexpected|not supported/i.test(msg) || upstream.status === 400) {
        const dropped = { ...requestBodyBase };
        delete dropped.top_k;
        candidates.push(dropped);
      }
    }

    for (const body of candidates) {
      upstream = await postJson(body);
      if (upstream.ok && upstream.body) break;
    }

    if (!upstream.ok || !upstream.body) {
      const text2 = await upstream.text().catch(() => "");
      const msg2 = extractAnthropicErrorText(text2);
      const detail = msg2 || msg;
      throw new Error(
        `Upstream error: ${upstream.status} ${upstream.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
      );
    }
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let assistantText = "";
  let finishReason: string | null = null;

  const toolUsesByIndex = new Map<number, ToolUseAccum>();
  const toolCalls = new Map<string, ToolCall>();

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

      const type = typeof parsed?.type === "string" ? parsed.type : "";

      if (type === "error") {
        const msg =
          typeof parsed?.error?.message === "string"
            ? parsed.error.message
            : typeof parsed?.error?.type === "string"
              ? parsed.error.type
              : "Unknown upstream stream error";
        throw new Error(`Upstream stream error: ${safeText(msg).slice(0, 200)}`);
      }

      if (type === "content_block_start") {
        const index = typeof parsed?.index === "number" && Number.isFinite(parsed.index) ? Math.trunc(parsed.index) : -1;
        const block = parsed?.content_block;
        if (index >= 0 && block && typeof block === "object" && block.type === "tool_use") {
          const callId = safeText(block.id);
          const name = safeText(block.name);

          // Anthropic streaming may emit an empty object for tool_use.input in content_block_start,
          // followed by the *actual* JSON via input_json_delta events. If we seed argsRaw with "{}",
          // concatenation produces invalid JSON like "{}{}" / "{}...".
          //
          // Strategy:
          // - Capture non-empty start input (if any) as startArgsRaw.
          // - Accumulate deltas separately as deltaArgsRaw.
          // - Prefer deltaArgsRaw when present.
          let startArgsRaw = "";
          if (block.input && typeof block.input === "string") {
            startArgsRaw = block.input;
          } else if (block.input && typeof block.input === "object") {
            try {
              const keys = Array.isArray(block.input) ? [] : Object.keys(block.input as any);
              if (keys.length) startArgsRaw = JSON.stringify(block.input);
              else startArgsRaw = "";
            } catch {
              startArgsRaw = "";
            }
          }

          if (callId && name) {
            const acc: ToolUseAccum = { callId, index, name, startArgsRaw, deltaArgsRaw: "" };
            toolUsesByIndex.set(index, acc);
            toolCalls.set(callId, { callId, index, name, argsRaw: (startArgsRaw || "{}") });
          }
        }
        continue;
      }

      if (type === "content_block_delta") {
        const index = typeof parsed?.index === "number" && Number.isFinite(parsed.index) ? Math.trunc(parsed.index) : -1;
        const delta = parsed?.delta;
        const deltaType = typeof delta?.type === "string" ? delta.type : "";

        if (deltaType === "text_delta") {
          const chunk = safeText(delta.text);
          if (chunk) {
            const nextText = mergePossiblyCumulative(assistantText, chunk);

            // Emit only new suffix (avoid duplicates for cumulative-streaming proxies).
            if (nextText.length > assistantText.length && nextText.startsWith(assistantText)) {
              const newPart = nextText.slice(assistantText.length);
              assistantText = nextText;
              if (newPart) args.onDelta(newPart);
            } else if (nextText !== assistantText) {
              const newPart = nextText.slice(assistantText.length);
              assistantText = nextText;
              if (newPart) args.onDelta(newPart);
            }
          }
          continue;
        }

        if (deltaType === "input_json_delta") {
          const piece = safeText(delta.partial_json ?? delta.json ?? "");
          if (!piece) continue;

          const acc = toolUsesByIndex.get(index);
          if (!acc) continue;

          acc.deltaArgsRaw = mergePossiblyCumulative(acc.deltaArgsRaw, piece);
          const effectiveArgsRaw = acc.deltaArgsRaw || acc.startArgsRaw || "{}";
          toolCalls.set(acc.callId, { callId: acc.callId, index: acc.index, name: acc.name, argsRaw: effectiveArgsRaw });
          continue;
        }

        continue;
      }

      if (type === "message_delta") {
        const stopReason = typeof parsed?.delta?.stop_reason === "string" ? parsed.delta.stop_reason : "";
        if (stopReason) finishReason = stopReason === "tool_use" ? "tool_calls" : stopReason;
        continue;
      }

      // message_stop/content_block_stop/etc are informational.
      if (type === "message_stop") {
        return { assistantText, toolCalls, finishReason };
      }
    }
  }

  return { assistantText, toolCalls, finishReason };
}
