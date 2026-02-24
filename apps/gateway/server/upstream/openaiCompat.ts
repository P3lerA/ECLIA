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
  onDelta: (text: string) => void;
  debug?: UpstreamRequestDebugCapture;
}): Promise<UpstreamTurnResult> {
  let upstream: Response;

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

  if (args.debug) {
    dumpUpstreamRequestBody({
      rootDir: args.debug.rootDir,
      sessionId: args.debug.sessionId,
      seq: args.debug.seq,
      providerKind: "openai_compat",
      upstreamModel: args.model,
      url: args.url,
      body: requestBody
    });
  }

  upstream = await fetch(args.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      ...args.headers
    },
    body: JSON.stringify(requestBody),
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
