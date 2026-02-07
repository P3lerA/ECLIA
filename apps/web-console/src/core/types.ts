export type Role = "system" | "user" | "assistant" | "tool";

/**
 * Origin metadata for blocks.
 * Different vendors/adapters may encode raw content differently, so keeping origin
 * per-block makes later UI parsing much easier.
 */
export type BlockOrigin = {
  adapter: string; // e.g. "openai_compat" | "sglang" | "client"
  vendor?: string; // e.g. "minimax" | "openai" | "custom"
  baseUrl?: string;
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
 * Renderers should keep this hidden/collapsed by default.
 */
export type ThoughtBlock = {
  type: "thought";
  text: string;
  visibility?: "internal" | "public";
  origin?: BlockOrigin;
};

export type Block = TextBlock | CodeBlock | ToolBlock | ThoughtBlock;

export type Message = {
  id: string;
  role: Role;
  blocks: Block[];
  createdAt: number;

  /**
   * streaming=true means this message will be appended over time (e.g. token deltas).
   */
  streaming?: boolean;
};

export type Session = {
  id: string;
  title: string;
  meta: string;
  createdAt: number;
  updatedAt?: number;

  /**
   * localOnly=true means this session only exists in the browser state.
   * It has not been created in the gateway store yet.
   *
   * This allows the UI to show a "draft" session (Landing screen) without
   * creating an empty .eclia/sessions/<id>/ directory on disk.
   */
  localOnly?: boolean;

  /**
   * UI hint: whether this session has entered the "chat" mode (vs Landing screen).
   * A cleared session can still be started=true (empty chat but stays in Chat view).
   */
  started?: boolean;
};

export type InspectorTabId = "events" | "tools" | "context";

export type LogItem = {
  id: string;
  tab: InspectorTabId;
  at: number;
  type: string;
  summary: string;
  data?: unknown;
};

export type ChatRequest = {
  sessionId: string;
  model: string;
  userText: string;

  /**
   * Runtime tool access policy (client preference).
   * - full: allow the gateway to execute tools automatically.
   * - safe: auto-run allowlisted tools only; otherwise require user approval.
   */
  toolAccessMode?: "full" | "safe";

  /**
   * Runtime preference: approximate context budget.
   * Default is 20k tokens (estimator-based).
   */
  contextTokenLimit?: number;
};

export type ChatEvent =
  | { type: "meta"; at: number; sessionId: string; model: string; usedTokens?: number; dropped?: number }
  | { type: "assistant_start"; at: number; messageId: string }
  | { type: "assistant_end"; at: number }
  | { type: "delta"; at: number; text: string }
  | { type: "tool_call"; at: number; callId?: string; name: string; args: unknown }
  | { type: "tool_result"; at: number; callId?: string; name: string; ok: boolean; result: unknown }
  | { type: "done"; at: number }
  | { type: "error"; at: number; message: string };

export type ChatEventHandlers = {
  onEvent: (evt: ChatEvent) => void;
};

export type PluginConfig = {
  id: string;
  name: string;
  enabled: boolean;
  description?: string;
};
