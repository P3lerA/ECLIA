import type { ChatTransport } from "./ChatTransport";
import type { ChatEvent, ChatEventHandlers, ChatRequest } from "../types";
import { parseSSE } from "./sseParser";

/**
 * Reads `text/event-stream` (SSE) via fetch() and parses events.
 * Why fetch: we can POST (EventSource is GET-only) and include a request body easily.
 */
export class SSEFetchTransport implements ChatTransport {
  private ac: AbortController | null = null;

  constructor(private opts: { endpoint: string }) {}

  abort = () => {
    this.ac?.abort();
    this.ac = null;
  };

  async streamChat(req: ChatRequest, handlers: ChatEventHandlers, signal?: AbortSignal) {
    this.abort();
    this.ac = new AbortController();

    const onAbort = () => this.ac?.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const resp = await fetch(this.opts.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(req),
      signal: this.ac.signal
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      throw new Error(`SSE backend error: ${resp.status} ${resp.statusText} ${text}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { events, rest } = parseSSE(buffer);
      buffer = rest;

      for (const e of events) {
        // Convention: server `event:` name matches ChatEvent.type
        // `data:` is JSON
        let payload: any = null;
        try {
          payload = e.data ? JSON.parse(e.data) : {};
        } catch {
          payload = { raw: e.data };
        }

        const evt = normalizeEvent(e.event, payload);
        if (evt) handlers.onEvent(evt);
      }
    }
  }
}

function normalizeEvent(eventName: string | null, payload: any): ChatEvent | null {
  const at = typeof payload?.at === "number" ? payload.at : Date.now();
  switch (eventName) {
    case "meta":
      return {
        type: "meta",
        at,
        sessionId: String(payload.sessionId ?? ""),
        model: String(payload.model ?? ""),
        usedTokens: typeof payload.usedTokens === "number" ? payload.usedTokens : undefined,
        dropped: typeof payload.dropped === "number" ? payload.dropped : undefined
      };
    case "assistant_start":
      return { type: "assistant_start", at, messageId: String(payload.messageId ?? payload.id ?? "") };
    case "assistant_end":
      return { type: "assistant_end", at };
    case "delta":
      return { type: "delta", at, text: String(payload.text ?? "") };
    case "tool_call":
      return {
        type: "tool_call",
        at,
        callId: typeof payload.callId === "string" ? payload.callId : undefined,
        name: String(payload.name ?? ""),
        args: payload.args
      };
    case "tool_result":
      return {
        type: "tool_result",
        at,
        callId: typeof payload.callId === "string" ? payload.callId : undefined,
        name: String(payload.name ?? ""),
        ok: Boolean(payload.ok),
        result: payload.result
      };
    case "done":
      return { type: "done", at };
    case "error":
      return { type: "error", at, message: String(payload.message ?? "error") };
    default:
      return null;
  }
}
