import type { Block, InspectorTabId, LogItem, Message, Session, PluginConfig } from "../core/types";
import type { TransportId } from "../core/transport/TransportRegistry";

export type AppState = {
  model: string;
  transport: TransportId;

  sessions: Session[];
  activeSessionId: string;

  messagesBySession: Record<string, Message[]>;

  plugins: PluginConfig[];

  inspectorTab: InspectorTabId;
  logsByTab: Record<InspectorTabId, LogItem[]>;
};

export type Action =
  | { type: "session/select"; sessionId: string }
  | { type: "session/new" }
  | { type: "model/set"; model: string }
  | { type: "transport/set"; transport: TransportId }
  | { type: "message/add"; sessionId: string; message: Message }
  | { type: "assistant/stream/start"; sessionId: string; messageId: string }
  | { type: "assistant/stream/append"; sessionId: string; text: string }
  | { type: "assistant/stream/finalize"; sessionId: string }
  | { type: "assistant/addBlocks"; sessionId: string; blocks: Block[] }
  | { type: "plugin/toggle"; pluginId: string }
  | { type: "messages/clear"; sessionId: string }
  | { type: "inspector/tab"; tab: InspectorTabId }
  | { type: "log/push"; item: LogItem };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "session/select":
      return { ...state, activeSessionId: action.sessionId };

    case "session/new": {
      const id = "s" + (state.sessions.length + 1);
      const now = Date.now();
      const meta = "just now · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const session: Session = { id, title: "New session", meta, createdAt: now };
      return {
        ...state,
        sessions: [session, ...state.sessions],
        activeSessionId: id,
        messagesBySession: { ...state.messagesBySession, [id]: [] }
      };
    }

    case "model/set":
      return { ...state, model: action.model };

    case "transport/set":
      return { ...state, transport: action.transport };

    case "plugin/toggle": {
      const next = state.plugins.map((p) =>
        p.id === action.pluginId ? { ...p, enabled: !p.enabled } : p
      );
      return { ...state, plugins: next };
    }

    case "message/add": {
      const list = state.messagesBySession[action.sessionId] ?? [];
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [action.sessionId]: [...list, action.message]
        }
      };
    }

    case "assistant/stream/start": {
      const list = state.messagesBySession[action.sessionId] ?? [];
      const msg: Message = {
        id: action.messageId,
        role: "assistant",
        createdAt: Date.now(),
        streaming: true,
        blocks: [{ type: "text", text: "" }]
      };
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [action.sessionId]: [...list, msg]
        }
      };
    }

    case "assistant/stream/append": {
      const list = state.messagesBySession[action.sessionId] ?? [];
      const idx = findLastStreamingAssistantIndex(list);
      if (idx < 0) return state;

      const msg = list[idx];
      const blocks = [...msg.blocks];
      const first = blocks[0];

      if (first?.type === "text") {
        blocks[0] = { ...first, text: first.text + action.text };
      } else {
        blocks.unshift({ type: "text", text: action.text });
      }

      const updated: Message = { ...msg, blocks };
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [action.sessionId]: replaceAt(list, idx, updated)
        }
      };
    }

    case "assistant/stream/finalize": {
      const list = state.messagesBySession[action.sessionId] ?? [];
      const idx = findLastStreamingAssistantIndex(list);
      if (idx < 0) return state;

      const msg = list[idx];
      const updated: Message = { ...msg, streaming: false };
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [action.sessionId]: replaceAt(list, idx, updated)
        }
      };
    }

    case "assistant/addBlocks": {
      const list = state.messagesBySession[action.sessionId] ?? [];
      const msg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        createdAt: Date.now(),
        blocks: action.blocks
      };
      return {
        ...state,
        messagesBySession: { ...state.messagesBySession, [action.sessionId]: [...list, msg] }
      };
    }

    case "messages/clear":
      return { ...state, messagesBySession: { ...state.messagesBySession, [action.sessionId]: [] } };

    case "inspector/tab":
      return { ...state, inspectorTab: action.tab };

    case "log/push": {
      const tab = action.item.tab;
      const list = state.logsByTab[tab] ?? [];
      return {
        ...state,
        logsByTab: {
          ...state.logsByTab,
          [tab]: [action.item, ...list].slice(0, 200)
        }
      };
    }

    default:
      return state;
  }
}

function replaceAt<T>(arr: T[], idx: number, value: T): T[] {
  const copy = arr.slice();
  copy[idx] = value;
  return copy;
}

function findLastStreamingAssistantIndex(list: Message[]): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === "assistant" && list[i].streaming) return i;
  }
  return -1;
}
