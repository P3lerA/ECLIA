export type Role = "user" | "assistant" | "tool";

export type TextBlock = {
  type: "text";
  text: string;
};

export type CodeBlock = {
  type: "code";
  language?: string;
  code: string;
};

export type ToolBlock = {
  type: "tool";
  name: string;
  status: "calling" | "ok" | "error";
  payload?: unknown;
};

export type Block = TextBlock | CodeBlock | ToolBlock;

export type Message = {
  id: string;
  role: Role;
  blocks: Block[];
  createdAt: number;

  /**
   * streaming=true 表示它会被持续 append（例如逐 token delta）
   */
  streaming?: boolean;
};

export type Session = {
  id: string;
  title: string;
  meta: string;
  createdAt: number;
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
};

export type ChatEvent =
  | { type: "meta"; at: number; sessionId: string; model: string }
  | { type: "delta"; at: number; text: string }
  | { type: "tool_call"; at: number; name: string; args: unknown }
  | { type: "tool_result"; at: number; name: string; ok: boolean; result: unknown }
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
