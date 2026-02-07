import type { AppState } from "./reducer";
import { readStoredThemeMode } from "../theme/theme";
import { readStoredPrefs } from "../persist/prefs";

function makeId(): string {
  const c: any = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function makeInitialState(): AppState {
  const themeMode = readStoredThemeMode();
  const prefs = readStoredPrefs();

  const now = Date.now();
  const id = makeId();

  // Minimal local placeholder; will be replaced by the gateway session list on boot if available.
  const sessions = [
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

  return {
    themeMode,
    sessions,
    activeSessionId: sessions[0].id,

    // Messages are loaded on-demand from the gateway.
    messagesBySession: {},

    settings: {
      textureDisabled: Boolean(prefs.textureDisabled ?? false),
      contextLimitEnabled: typeof prefs.contextLimitEnabled === "boolean" ? prefs.contextLimitEnabled : true,
      contextTokenLimit: typeof prefs.contextTokenLimit === "number" ? prefs.contextTokenLimit : 20000
    },

    model: prefs.model ?? "openai-compatible",
    transport: (prefs.transport ?? "sse") as any,

    plugins: [
      { id: "sessions", name: "Session Sync", enabled: true, description: "Persist sessions to the backend" },
      { id: "tools", name: "Tool Harness", enabled: true, description: "Allow tool blocks to execute shell commands" },
      { id: "render-md", name: "Markdown", enabled: false, description: "Render markdown blocks" }
    ].map((p) => ({
      ...p,
      enabled: typeof prefs.plugins?.[p.id] === "boolean" ? Boolean(prefs.plugins?.[p.id]) : p.enabled
    })),

    gpu: { available: null },

    inspectorTab: "events",
    logsByTab: { events: [], tools: [], context: [] }
  };
}
