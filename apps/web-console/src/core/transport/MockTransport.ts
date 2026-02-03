import type { ChatTransport } from "./ChatTransport";
import type { ChatRequest } from "../types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockTransport implements ChatTransport {
  private ac: AbortController | null = null;

  abort = () => {
    this.ac?.abort();
    this.ac = null;
  };

  async streamChat(req: ChatRequest, handlers: any, signal?: AbortSignal) {
    // Use an internal AbortController so the UI can cancel in-flight requests.
    this.abort();
    this.ac = new AbortController();

    const onAbort = () => this.ac?.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const { onEvent } = handlers;

    onEvent({ type: "meta", at: Date.now(), sessionId: req.sessionId, model: req.model });

    const chunks = [
      `Got it. This console shell has two core ideas:

1) Message = blocks (pluggable rendering)
2) Backend output = event stream (Transport is swappable)`,
      `You\'re currently seeing the mock transport: it simulates streaming output with a timer in the browser.`,
      `When you wire up a real backend, replace the transport with SSE / fetch streaming / WebSocket.`
    ];

    for (const c of chunks) {
      if (this.ac.signal.aborted) throw new DOMException("aborted", "AbortError");
      await sleep(260);
      onEvent({ type: "delta", at: Date.now(), text: c + "\n\n" });
    }

    await sleep(180);
    onEvent({ type: "tool_call", at: Date.now(), name: "plan_ui", args: { layout: "3-column", inspector: true } });
    await sleep(220);
    onEvent({
      type: "tool_result",
      at: Date.now(),
      name: "plan_ui",
      ok: true,
      result: { panels: ["sessions", "chat", "inspector"], extensible: true }
    });

    await sleep(120);
    onEvent({ type: "done", at: Date.now() });
  }
}
