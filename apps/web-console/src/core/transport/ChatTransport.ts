import type { ChatEventHandlers, ChatRequest } from "../types";

export interface ChatTransport {
  /**
   * Streams model output as an event stream (delta / tool_call / tool_result / done).
   * Note: the UI should not care whether the backend is OpenAI, local, etc.
   */
  streamChat(
    req: ChatRequest,
    handlers: ChatEventHandlers,
    signal?: AbortSignal
  ): Promise<void>;

  /**
   * Optional: immediately abort an in-flight stream.
   */
  abort?: () => void;
}
