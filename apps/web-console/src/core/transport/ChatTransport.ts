import type { ChatEventHandlers, ChatRequest } from "../types";

export interface ChatTransport {
  /**
   * 以事件流的方式回传模型输出（delta / tool_call / tool_result / done）
   * 注意：UI 不应该关心“到底是 OpenAI 还是本地模型”
   */
  streamChat(
    req: ChatRequest,
    handlers: ChatEventHandlers,
    signal?: AbortSignal
  ): Promise<void>;

  /**
   * 可选：立即终止正在进行的流
   */
  abort?: () => void;
}
