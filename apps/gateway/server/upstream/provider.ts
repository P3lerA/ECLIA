import type { StoredMessage } from "../sessionTypes.js";

export type ToolCall = {
  callId: string;
  index?: number;
  name: string;
  argsRaw: string;
};

export type ProviderTurnResult = {
  assistantText: string;
  toolCalls: Map<string, ToolCall>;
  finishReason: string | null;
};

export type BuiltContext = {
  messages: any[];
  usedTokens: number;
  dropped: number;
};

export type UpstreamOrigin = {
  adapter: string;
  vendor?: string;
  baseUrl?: string;
  model?: string;
};

/**
 * Abstraction boundary for "upstream" inference.
 *
 * This is intentionally small: we only model the pieces that are
 * OpenAI-compatible today but are expected to vary for other providers
 * (Anthropic, Codex app-server, etc.).
 */
export interface UpstreamProvider {
  /** Stable provider kind identifier (e.g. "openai_compat"). */
  readonly kind: string;
  /** Origin metadata that gets persisted onto assistant blocks. */
  readonly origin: UpstreamOrigin;
  /** Upstream model id. */
  readonly upstreamModel: string;

  buildContext(history: StoredMessage[], tokenLimit: number): BuiltContext;

  streamTurn(args: {
    headers: Record<string, string>;
    messages: any[];
    tools: any[];
    signal: AbortSignal;
    onDelta: (text: string) => void;
  }): Promise<ProviderTurnResult>;

  buildAssistantToolCallMessage(args: { assistantText: string; toolCalls: ToolCall[] }): any;
  buildToolResultMessage(args: { callId: string; content: string }): any;
}
