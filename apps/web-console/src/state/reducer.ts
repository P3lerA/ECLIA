import type { Block, InspectorTabId, LogItem, Message, Session } from "../core/types";
import type { TransportId } from "../core/transport/TransportRegistry";
import type { ThemeMode } from "../theme/theme";

export type AppSettings = {
  /**
   * Disable background textures (WebGL). When enabled, the background becomes a solid color.
   */
  textureDisabled: boolean;

  /**
   * Whether to apply context truncation.
   *
   * When disabled, the UI will send a very large budget to the gateway so the
   * full session history is included (useful for debugging).
   */
  contextLimitEnabled: boolean;

  /**
   * Approximate context budget (token estimator). Default: 20000.
   */
  contextTokenLimit: number;

  /**
   * Tool access mode for potentially dangerous tools (starting with exec).
   * - full: allow the gateway to execute automatically.
   * - safe: only auto-run allowlisted commands, otherwise require approval.
   */
  execAccessMode: "full" | "safe";

  /**
   * Whether the UI should keep sessions/messages in sync with the local gateway.
   *
   * When disabled, the UI will rely on local state and skip best-effort
   * re-hydration of sessions/messages from the gateway.
   */
  sessionSyncEnabled: boolean;

  /**
   * Output rendering preference.
   * When true, prefers "plain" output (debug-friendly).
   */
  displayPlainOutput: boolean;
};

export type AppGPU = {
  available: boolean | null; // null=unknown/checking
};

export type AppState = {
  themeMode: ThemeMode;

  model: string;
  transport: TransportId;

  sessions: Session[];
  activeSessionId: string;

  messagesBySession: Record<string, Message[]>;

  settings: AppSettings;
  gpu: AppGPU;

  inspectorTab: InspectorTabId;
  logsByTab: Record<InspectorTabId, LogItem[]>;
};

export type Action =
  | { type: "theme/setMode"; mode: ThemeMode }
  | { type: "sessions/replace"; sessions: Session[]; activeSessionId?: string }
  | { type: "sessions/remove"; sessionIds: string[] }
  | { type: "session/add"; session: Session; makeActive?: boolean }
  | { type: "session/update"; sessionId: string; patch: Partial<Session> }
  | { type: "session/select"; sessionId: string }
  | { type: "session/new" } // create a local-only draft session (no gateway folder until first message)
  | { type: "model/set"; model: string }
  | { type: "transport/set"; transport: TransportId }
  | { type: "settings/textureDisabled"; enabled: boolean }
  | { type: "settings/sessionSyncEnabled"; enabled: boolean }
  | { type: "settings/contextLimitEnabled"; enabled: boolean }
  | { type: "settings/contextTokenLimit"; value: number }
  | { type: "settings/execAccessMode"; mode: "full" | "safe" }
  | { type: "settings/displayPlainOutput"; enabled: boolean }
  | { type: "gpu/available"; available: boolean }
  | { type: "message/add"; sessionId: string; message: Message }
  | { type: "messages/set"; sessionId: string; messages: Message[] }
  | { type: "assistant/stream/start"; sessionId: string; messageId: string }
  | { type: "assistant/stream/append"; sessionId: string; text: string }
  | { type: "assistant/stream/finalize"; sessionId: string }
  | { type: "assistant/addBlocks"; sessionId: string; blocks: Block[] }
  | { type: "messages/clear"; sessionId: string }
  | { type: "inspector/tab"; tab: InspectorTabId }
  | { type: "log/push"; item: LogItem };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "theme/setMode":
      if (state.themeMode === action.mode) return state;
      return { ...state, themeMode: action.mode };

    case "sessions/replace": {
      const sessions = action.sessions;
      const desired = action.activeSessionId ?? state.activeSessionId;
      const active =
        sessions.find((s) => s.id === desired)?.id ?? sessions[0]?.id ?? state.activeSessionId;
      return { ...state, sessions, activeSessionId: active };
    }

    case "sessions/remove": {
      const ids = (action.sessionIds ?? []).filter((x) => typeof x === "string" && x.trim());
      if (ids.length === 0) return state;

      const remove = new Set(ids);
      let sessions = state.sessions.filter((s) => !remove.has(s.id));
      const messagesBySession = { ...state.messagesBySession };
      for (const id of remove) delete messagesBySession[id];

      let activeSessionId = state.activeSessionId;
      if (remove.has(activeSessionId)) {
        activeSessionId = sessions[0]?.id ?? activeSessionId;
      }

      // Ensure the UI never ends up with zero sessions.
      if (sessions.length === 0) {
        const id = makeId();
        const now = Date.now();
        sessions = [
          {
            id,
            title: "New session",
            meta: "just now",
            createdAt: now,
            updatedAt: now,
            localOnly: true,
            started: false
          }
        ];
        activeSessionId = id;
      }

      return { ...state, sessions, activeSessionId, messagesBySession };
    }

    case "session/add": {
      const exists = state.sessions.some((s) => s.id === action.session.id);
      const sessions = exists
        ? state.sessions.map((s) => (s.id === action.session.id ? action.session : s))
        : [action.session, ...state.sessions];
      return {
        ...state,
        sessions,
        activeSessionId: action.makeActive ? action.session.id : state.activeSessionId
      };
    }

    case "session/update": {
      const sessions = state.sessions.map((s) =>
        s.id === action.sessionId ? { ...s, ...action.patch } : s
      );
      return { ...state, sessions };
    }

    case "settings/textureDisabled":
      if (state.settings.textureDisabled === action.enabled) return state;
      return { ...state, settings: { ...state.settings, textureDisabled: action.enabled } };

    case "settings/sessionSyncEnabled":
      if (state.settings.sessionSyncEnabled === action.enabled) return state;
      return { ...state, settings: { ...state.settings, sessionSyncEnabled: action.enabled } };

    case "settings/contextLimitEnabled":
      if (state.settings.contextLimitEnabled === action.enabled) return state;
      return { ...state, settings: { ...state.settings, contextLimitEnabled: action.enabled } };

    case "settings/contextTokenLimit": {
      const v = clampInt(action.value, 256, 1_000_000);
      if (state.settings.contextTokenLimit === v) return state;
      return { ...state, settings: { ...state.settings, contextTokenLimit: v } };
    }

    case "settings/execAccessMode":
      if (state.settings.execAccessMode === action.mode) return state;
      return { ...state, settings: { ...state.settings, execAccessMode: action.mode } };

    case "settings/displayPlainOutput":
      if (state.settings.displayPlainOutput === action.enabled) return state;
      return { ...state, settings: { ...state.settings, displayPlainOutput: action.enabled } };

    case "gpu/available":
      if (state.gpu.available === action.available) return state;
      return { ...state, gpu: { ...state.gpu, available: action.available } };

    case "session/select":
      return { ...state, activeSessionId: action.sessionId };

    case "session/new": {
      // Drop any previous *empty* local-only draft sessions.
      // This prevents "New session" spam in the UI when the user clicks the
      // button multiple times without sending anything.
      const kept = state.sessions.filter((s) => {
        if (!s.localOnly) return true;
        const msgs = state.messagesBySession[s.id];
        const hasMsgs = Array.isArray(msgs) && msgs.length > 0;
        if (hasMsgs) return true;
        // Keep if the UI explicitly entered chat mode (e.g. user cleared)
        return Boolean(s.started);
      });

      const id = makeId();
      const now = Date.now();
      const meta = "just now";
      const session: Session = {
        id,
        title: "New session",
        meta,
        createdAt: now,
        updatedAt: now,
        localOnly: true,
        started: false
      };
      return {
        ...state,
        sessions: [session, ...kept],
        activeSessionId: id,
        messagesBySession: { ...state.messagesBySession }
      };
    }

    case "model/set":
      return { ...state, model: action.model };

    case "transport/set":
      return { ...state, transport: action.transport };

    case "messages/set": {
      const sessions = action.messages.length > 0 ? ensureSessionStarted(state.sessions, action.sessionId) : state.sessions;
      return {
        ...state,
        sessions,
        messagesBySession: {
          ...state.messagesBySession,
          [action.sessionId]: action.messages
        }
      };
    }

    case "message/add": {
      const list = state.messagesBySession[action.sessionId] ?? [];
      const nextMessages = [...list, action.message];
      const sessions = ensureSessionStarted(state.sessions, action.sessionId);
      return {
        ...state,
        sessions,
        messagesBySession: {
          ...state.messagesBySession,
          [action.sessionId]: nextMessages
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

      const sessions = ensureSessionStarted(state.sessions, action.sessionId);

      return {
        ...state,
        sessions,
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
        blocks[0] = { ...first, text: (first.text ?? "") + action.text };
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
        id: makeId(),
        role: "assistant",
        createdAt: Date.now(),
        blocks: action.blocks
      };

      const sessions = ensureSessionStarted(state.sessions, action.sessionId);

      return {
        ...state,
        sessions,
        messagesBySession: { ...state.messagesBySession, [action.sessionId]: [...list, msg] }
      };
    }

    case "messages/clear": {
      const now = Date.now();
      const sessions = state.sessions.map((s) =>
        s.id === action.sessionId
          ? { ...s, title: "New session", meta: "just now", createdAt: now, updatedAt: now, started: true }
          : s
      );

      return {
        ...state,
        sessions,
        messagesBySession: { ...state.messagesBySession, [action.sessionId]: [] }
      };
    }

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

function ensureSessionStarted(sessions: Session[], sessionId: string): Session[] {
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return sessions;

  const s = sessions[idx];
  if (s.started) return sessions;

  const next = sessions.slice();
  next[idx] = { ...s, started: true };
  return next;
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

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function makeId(): string {
  const c: any = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
