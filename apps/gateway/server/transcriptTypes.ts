/**
 * Canonical transcript format (OpenAI-compatible messages).
 *
 * The goal is that persisted data can be replayed into any OpenAI-compatible
 * /chat/completions API without lossy "UI-first" projections.
 */

export type OpenAICompatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON string (verbatim). */
    arguments: string;
  };
};

export type OpenAICompatAssistantMessage = {
  role: "assistant";
  /**
   * Assistant content as returned by the upstream (may include <think> blocks).
   * Some providers explicitly require <think> to be present in replayed context.
   */
  content: any;
  tool_calls?: OpenAICompatToolCall[];
};

export type OpenAICompatUserMessage = {
  role: "user";
  content: any;
};

export type OpenAICompatSystemMessage = {
  role: "system";
  content: any;
};

export type OpenAICompatToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: any;
};

export type OpenAICompatMessage =
  | OpenAICompatSystemMessage
  | OpenAICompatUserMessage
  | OpenAICompatAssistantMessage
  | OpenAICompatToolMessage;

/**
 * Per-user-turn metadata.
 *
 * This is NOT an OpenAI message. It's a persistence-only record that allows:
 * - turn-based truncation and debugging
 * - UI projection ("show work process" vs "final only")
 */
export type TranscriptTurnV1 = {
  /** Stable id for this logical user-turn (useful for correlation/debugging). */
  turnId?: string;

  tokenLimit: number;
  usedTokens: number;

  /** Resolved upstream (best-effort). */
  upstream?: {
    /** UI route key (may be a profile route like `openai-compatible:<id>`). */
    routeKey: string;
    /** Resolved upstream model id (e.g. `gpt-4o-mini`). */
    model: string;
    /** Provider base URL. For non-HTTP providers, may be a sentinel like `codex_app_server`. */
    baseUrl: string;
  };

  /** Local git metadata snapshot (best-effort; null when unavailable). */
  git?: {
    commit: string | null;
    branch: string | null;
    dirty: boolean | null;
  };

  /** Per-request runtime sampling overrides (as provided by the client). */
  runtime?: {
    temperature: number | null;
    topP: number | null;
    topK: number | null;
    /** null means "unlimited / omitted" (provider default). */
    maxOutputTokens: number | null;
  };

  /** Redundant tool access mode snapshot (useful for debugging). */
  toolAccessMode?: "full" | "safe";
};

export type TranscriptRecordV1 =
  | {
      v: 1;
      id: string;
      ts: number;
      type: "msg";
      msg: OpenAICompatMessage;
    }
  | {
      v: 1;
      id: string;
      ts: number;
      type: "reset";
    }
  | {
      v: 1;
      id: string;
      ts: number;
      type: "turn";
      turn: TranscriptTurnV1;
    };
