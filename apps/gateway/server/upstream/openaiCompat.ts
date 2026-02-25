import crypto from "node:crypto";

import type { UpstreamRequestDebugCapture } from "./provider.js";

import { dumpUpstreamRequestBody } from "../debug/upstreamRequests.js";

export type ToolCallAccum = { callId: string; index?: number; name: string; argsRaw: string };

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

function safeText(v: any): string {
  return typeof v === "string" ? v : "";
}

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
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

export type UpstreamTurnResult = {
  assistantText: string;
  toolCalls: Map<string, ToolCallAccum>;
  finishReason: string | null;
};

export async function streamOpenAICompatTurn(args: {
  url: string;
  headers: Record<string, string>;
  model: string;
  messages: any[];
  signal: AbortSignal;
  tools: any[];
  /** Optional sampling temperature override. */
  temperature?: number;
  /** Optional nucleus sampling override (top_p). */
  topP?: number;
  /** Optional top-k sampling override (non-standard). */
  topK?: number;
  /** Optional output token limit override (max_tokens/max_output_tokens). */
  maxOutputTokens?: number;
  onDelta: (text: string) => void;
  debug?: UpstreamRequestDebugCapture;
}): Promise<UpstreamTurnResult> {
  let upstream: Response;

  function urlHost(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function isLikelyStrictOpenAIHost(host: string): boolean {
    // OpenAI Chat Completions does not accept many vendor extensions (e.g. top_k).
    // Azure OpenAI typically follows the same schema.
    return host === "api.openai.com" || host.endsWith(".openai.azure.com");
  }

  function extractUpstreamErrorText(raw: string): string {
    const t = String(raw ?? "").trim();
    if (!t) return "";
    try {
      const j = JSON.parse(t);
      const msg = j?.error?.message ?? j?.message;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    } catch {
      // ignore
    }
    return t;
  }

  async function postJson(body: any): Promise<Response> {
    if (args.debug) {
      dumpUpstreamRequestBody({
        rootDir: args.debug.rootDir,
        sessionId: args.debug.sessionId,
        seq: args.debug.seq,
        providerKind: "openai_compat",
        upstreamModel: args.model,
        url: args.url,
        body
      });
    }

    return await fetch(args.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        ...args.headers
      },
      body: JSON.stringify(body),
      signal: args.signal
    });
  }

  const requestBody: any = {
    model: args.model,
    stream: true,
    messages: args.messages
  };

  // Only include the tools payload when we actually have tools to expose.
  // Some upstream providers reject { tool_choice: "auto", tools: [] }.
  if (Array.isArray(args.tools) && args.tools.length) {
    requestBody.tool_choice = "auto";
    requestBody.tools = args.tools;
  }

  if (typeof args.temperature === "number" && Number.isFinite(args.temperature)) {
    requestBody.temperature = Math.max(0, Math.min(2, args.temperature));
  }

  if (typeof args.topP === "number" && Number.isFinite(args.topP)) {
    requestBody.top_p = Math.max(0, Math.min(1, args.topP));
  }

  // Output cap: OpenAI-compatible Chat Completions uses `max_tokens`.
  // Some providers instead accept `max_output_tokens`. We default to `max_tokens` and
  // fall back on schema errors.
  let maxOut: number | null = null;
  if (typeof args.maxOutputTokens === "number" && Number.isFinite(args.maxOutputTokens)) {
    const i = Math.trunc(args.maxOutputTokens);
    // Allow -1/0 as a sentinel meaning "unlimited" (omit from request).
    if (i > 0) maxOut = Math.max(1, Math.min(200_000, i));
  }
  if (maxOut !== null) requestBody.max_tokens = maxOut;

  // Non-standard: top_k.
  // We avoid sending this to known-strict OpenAI/Azure hosts.
  const topK =
    typeof args.topK === "number" && Number.isFinite(args.topK)
      ? Math.max(1, Math.min(1000, Math.trunc(args.topK)))
      : null;
  const host = urlHost(args.url);
  const allowTopK = topK !== null && !isLikelyStrictOpenAIHost(host);
  if (allowTopK) requestBody.top_k = topK;

  // Attempt request (+ controlled fallbacks for non-standard fields).
  upstream = await postJson(requestBody);

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    const msg = extractUpstreamErrorText(text);

    const candidates: any[] = [];

    // Fallback 1: some providers reject `max_tokens` but accept `max_output_tokens`.
    if (maxOut !== null && Object.prototype.hasOwnProperty.call(requestBody, "max_tokens") && /max_tokens/i.test(msg)) {
      const swapped = { ...requestBody };
      delete swapped.max_tokens;
      swapped.max_output_tokens = maxOut;
      candidates.push(swapped);
    }

    // Fallback 2: some providers reject vendor extensions like `top_k`.
    if (Object.prototype.hasOwnProperty.call(requestBody, "top_k")) {
      // If we have a clear hint, or the error message is empty/generic, try dropping it once.
      if (!msg || /top_k|unknown|unrecognized|unexpected|not supported/i.test(msg) || upstream.status === 400) {
        const dropped = { ...requestBody };
        delete dropped.top_k;
        candidates.push(dropped);
      }
    }

    // Fallback 3: combined fallback (swap + drop) if both were set.
    if (maxOut !== null && Object.prototype.hasOwnProperty.call(requestBody, "top_k")) {
      const combo = { ...requestBody };
      delete combo.top_k;
      if (Object.prototype.hasOwnProperty.call(combo, "max_tokens")) {
        delete combo.max_tokens;
        combo.max_output_tokens = maxOut;
      }
      // Avoid duplicates.
      if (candidates.length) {
        const last = candidates[candidates.length - 1];
        if (JSON.stringify(last) !== JSON.stringify(combo)) candidates.push(combo);
      } else {
        candidates.push(combo);
      }
    }

    for (const body of candidates) {
      upstream = await postJson(body);
      if (upstream.ok && upstream.body) break;
    }

    if (!upstream.ok || !upstream.body) {
      const text2 = await upstream.text().catch(() => "");
      const msg2 = extractUpstreamErrorText(text2);
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
  const toolCallsAcc = createToolCallAccState();
  let finishReason: string | null = null;
  const legacyFunctionCallId = `fc_${crypto.randomUUID()}`;

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
      const message = choice?.message;

      const contentRaw =
        typeof delta?.content === "string"
          ? delta.content
          : typeof message?.content === "string"
            ? message.content
            : "";

      const content = safeText(contentRaw);

      if (content) {
        // Some OpenAI-compatible providers stream cumulative strings (full content so far) rather than incremental deltas.
        // Others stream true deltas. `mergePossiblyCumulative` handles both.
        const nextText = mergePossiblyCumulative(assistantText, content);

        // Emit only the new suffix (avoid duplicating when the provider streams cumulative strings).
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

      const tcList = Array.isArray(delta?.tool_calls)
        ? delta.tool_calls
        : Array.isArray(message?.tool_calls)
          ? message.tool_calls
          : null;

      const hasToolCalls = Boolean(tcList && tcList.length);

      if (hasToolCalls) {
        for (let i = 0; i < tcList!.length; i++) mergeToolCallDelta(toolCallsAcc, tcList![i], i);
      } else {
        // Legacy OpenAI function_call (pre-tool_calls) support (some OpenAI-compatible proxies still emit this).
        const fc = delta?.function_call ?? message?.function_call;
        if (fc && typeof fc === "object") {
          mergeToolCallDelta(
            toolCallsAcc,
            { index: 0, id: legacyFunctionCallId, function: { name: (fc as any).name, arguments: (fc as any).arguments } },
            0
          );
        }
      }

      const fr = choice?.finish_reason;
      if (typeof fr === "string" && fr) finishReason = fr;
    }
  }

  return { assistantText, toolCalls: toolCallsAcc.calls, finishReason };
}
