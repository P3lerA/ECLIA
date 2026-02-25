import type { OpenAICompatMessage } from "../transcriptTypes.js";

export type ToolCall = {
  callId: string;
  index?: number;
  name: string;
  argsRaw: string;
};

export type ToolResult = {
  callId: string;
  /** Content string that will be passed back to the upstream in its tool-result format. */
  content: string;
  /** Whether the tool execution succeeded (used by some providers for is_error flags). */
  ok: boolean;
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

  /**
   * Build an assistant message that represents tool invocations in the upstream format.
   *
   * - OpenAI-compatible upstreams: assistant message with tool_calls.
   * - Anthropic Messages API: assistant content blocks with tool_use.
   */
  buildAssistantToolCallMessage(args: { assistantText: string; toolCalls: ToolCall[] }): any;

  /**
   * Build one-or-more messages that represent tool results in the upstream format.
   *
   * Important nuance:
   * - OpenAI-compatible upstreams model tool results as N separate {role:"tool"} messages.
   * - Anthropic Messages API requires a *single* {role:"user"} message containing only
   *   tool_result blocks for a given tool-use round.
   */
  buildToolResultMessages(args: { results: ToolResult[] }): any[];
}
