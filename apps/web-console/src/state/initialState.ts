import type { AppState } from "./reducer";
import { readStoredThemeMode } from "../theme/theme";

function nowMeta(label: string) {
  const d = new Date();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${label} · ${hm}`;
}

export function makeInitialState(): AppState {
  const t = Date.now();

  return {
    page: "console",

    themeMode: readStoredThemeMode(),

    model: "local/ollama",
    transport: "mock",

    sessions: [
      { id: "s1", title: "New session", meta: nowMeta("just now"), createdAt: t, started: false },
      { id: "s2", title: "Tool call: Browser automation", meta: nowMeta("yesterday"), createdAt: t - 86400000, started: true },
      { id: "s3", title: "Prompt experiment: JSON Schema", meta: nowMeta("last week"), createdAt: t - 7 * 86400000, started: false }
    ],
    activeSessionId: "s1",

    messagesBySession: {
      // s1 starts empty: Landing view (center prompt + MENU)
      s1: [],

      // s2 is a sample conversation so you can instantly see the chat UI
      s2: [
        {
          id: "m21",
          role: "assistant",
          createdAt: t - 86400000 + 1000,
          blocks: [
            {
              type: "text",
              text:
                "This is a sample session.\n\n" +
                "This console is built around two ideas:\n" +
                "- Message = blocks (pluggable rendering)\n" +
                "- Backend output = event stream (Transport is swappable)\n\n" +
                "The UI stays simple; capabilities come from backends and plugins."
            }
          ]
        },
        {
          id: "m22",
          role: "user",
          createdAt: t - 86400000 + 2000,
          blocks: [{ type: "text", text: "Make MENU a bottom sheet and allow switching past sessions." }]
        },
        {
          id: "m23",
          role: "assistant",
          createdAt: t - 86400000 + 3000,
          blocks: [
            { type: "tool", name: "plan_ui", status: "ok", payload: { menu: "bottom-sheet", sidebar: false } }
          ]
        }
      ],

      s3: []
    },

    plugins: [
      { id: "sessions", name: "Session Sync", enabled: true, description: "Persist sessions to the backend" },
      { id: "tools", name: "Tools Runtime", enabled: true, description: "Enable tool_call / tool_result events" },
      { id: "rag", name: "RAG", enabled: false, description: "Retrieval augmentation (citations/recall)" },
      { id: "trace", name: "Tracing", enabled: false, description: "Observability and event tracing" }
    ],

    settings: {
      staticContourFallback: true,
      textureDisabled: false
    },

    gpu: {
      available: null
    },

    inspectorTab: "events",
    logsByTab: {
      events: [{ id: "l1", tab: "events", at: t, type: "boot", summary: "app start", data: {} }],
      tools: [],
      context: []
    }
  };
}
