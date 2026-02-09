export type BlockOrigin = {
  /**
   * Adapter/protocol used by the gateway.
   * Example: "openai_compat"
   */
  adapter: string;

  /**
   * Optional vendor hint inferred from base_url (best-effort).
   * Example: "minimax" | "openai" | "custom"
   */
  vendor?: string;

  /**
   * Upstream base URL (non-secret).
   */
  baseUrl?: string;

  /**
   * Upstream model id.
   */
  model?: string;
};

export type TextBlock = {
  type: "text";
  text: string;
  origin?: BlockOrigin;
};

export type CodeBlock = {
  type: "code";
  language?: string;
  code: string;
  origin?: BlockOrigin;
};

export type ToolBlock = {
  type: "tool";
  name: string;
  status: "calling" | "ok" | "error";
  payload?: unknown;
  origin?: BlockOrigin;
};

/**
 * Internal reasoning chunk (e.g. <think>...</think>).
 * UI should treat this as hidden by default.
 */
export type ThoughtBlock = {
  type: "thought";
  text: string;
  visibility?: "internal" | "public";
  origin?: BlockOrigin;
};

export type Block = TextBlock | CodeBlock | ToolBlock | ThoughtBlock;

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type StoredMessage = {
  id: string;
  role: MessageRole;
  createdAt: number;
  blocks: Block[];

  /**
   * Raw upstream text (verbatim). Useful for re-parsing when adapters evolve.
   * For user messages, this is usually just the user input.
   */
  raw?: string;

  /**
   * Optional tool metadata (future).
   */
  toolCallId?: string;
  toolName?: string;
};

export type SessionMetaV1 = {
  v: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;

  /**
   * Optional: where this session lives (used by tools like `send`).
   * Examples:
   * - { kind: "web" }
   * - { kind: "discord", channelId: "...", threadId: "..." }
   */
  origin?: {
    kind: string;
    [k: string]: unknown;
  };

  /**
   * Optional: last used route key / upstream model, for UX.
   */
  lastModel?: string;
};

export type SessionEventV1 =
  | {
      v: 1;
      id: string;
      ts: number;
      type: "message";
      message: StoredMessage;
    }
  | {
      v: 1;
      id: string;
      ts: number;
      type: "tool_call";
      call: {
        callId: string;
        name: string;
        argsRaw: string;
      };
    }
  | {
      v: 1;
      id: string;
      ts: number;
      type: "tool_result";
      result: {
        callId: string;
        name: string;
        ok: boolean;
        output: unknown;
      };
    }
  | {
      v: 1;
      id: string;
      ts: number;
      type: "reset";
    };

export type SessionDetail = {
  meta: SessionMetaV1;
  messages: StoredMessage[];
};
