import type { OpenAICompatMessage } from "../transcriptTypes.js";

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

export type UpstreamRequestDebugCapture = {
  /** Repository/project root (used to resolve <repo>/.eclia/debug). */
  rootDir: string;
  /** Session id (used to bucket dumps by session). */
  sessionId: string;
  /** Best-effort monotonically increasing counter (per session). */
  seq: number;
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

  /**
   * Build a truncated OpenAI-compatible message list for the upstream.
   *
   * NOTE: Some providers require <think> blocks to be present in replayed context;
   * the gateway therefore persists assistant content verbatim and does not strip it.
   */
  buildContext(history: OpenAICompatMessage[], tokenLimit: number): BuiltContext;

  streamTurn(args: {
    headers: Record<string, string>;
    messages: any[];
    tools: any[];
    /** Optional sampling temperature override (OpenAI-compatible). */
    temperature?: number;
    /** Optional nucleus sampling override (top_p, OpenAI-compatible). */
    topP?: number;
    /** Optional top-k sampling override (non-standard). */
    topK?: number;
    /** Optional output token limit override (max_tokens/max_output_tokens). */
    maxOutputTokens?: number;
    signal: AbortSignal;
    onDelta: (text: string) => void;
    debug?: UpstreamRequestDebugCapture;
  }): Promise<ProviderTurnResult>;

  buildAssistantToolCallMessage(args: { assistantText: string; toolCalls: ToolCall[] }): any;
  buildToolResultMessage(args: { callId: string; content: string }): any;
}
