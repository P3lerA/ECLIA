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
    // 绑一个内部 AbortController，支持 UI “新请求打断旧请求”
    this.abort();
    this.ac = new AbortController();

    const onAbort = () => this.ac?.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const { onEvent } = handlers;

    onEvent({ type: "meta", at: Date.now(), sessionId: req.sessionId, model: req.model });

    const chunks = [
      "好的。这个前端壳的关键点只有两个：\n\n1) Message = blocks（可插拔渲染）\n2) 后端输出 = event stream（Transport 可替换）\n",
      "你现在看到的是 mock transport：它在前端本地用定时器模拟逐段输出。\n",
      "接你的真实后端时，把 transport 换成 SSE / fetch stream / WebSocket 即可。"
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
