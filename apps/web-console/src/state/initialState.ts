import type { AppState } from "./reducer";
import { readStoredThemeMode } from "../theme/theme";
import { readStoredPrefs } from "../persist/prefs";
import { defaultEnabledToolNames, normalizeEnabledToolNames } from "../core/tools/ToolRegistry";

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
      sessionSyncEnabled: typeof prefs.sessionSyncEnabled === "boolean" ? prefs.sessionSyncEnabled : true,
      contextLimitEnabled: typeof prefs.contextLimitEnabled === "boolean" ? prefs.contextLimitEnabled : true,
      contextTokenLimit: typeof prefs.contextTokenLimit === "number" ? prefs.contextTokenLimit : 20000,
      temperature: typeof prefs.temperature === "number" && Number.isFinite(prefs.temperature) ? Math.max(0, Math.min(2, prefs.temperature)) : null,
      topP: typeof prefs.topP === "number" && Number.isFinite(prefs.topP) ? Math.max(0, Math.min(1, prefs.topP)) : null,
      topK: typeof prefs.topK === "number" && Number.isFinite(prefs.topK) ? Math.max(1, Math.min(1000, Math.trunc(prefs.topK))) : null,
      maxOutputTokens:
        typeof prefs.maxOutputTokens === "number" && Number.isFinite(prefs.maxOutputTokens)
          ? Math.trunc(prefs.maxOutputTokens) <= 0
            ? null
            : Math.max(1, Math.min(200_000, Math.trunc(prefs.maxOutputTokens)))
          : null,
      toolAccessMode: prefs.toolAccessMode === "safe" ? "safe" : "full",
      enabledTools:
        prefs.enabledTools === undefined ? defaultEnabledToolNames() : normalizeEnabledToolNames(prefs.enabledTools),
      displayPlainOutput: Boolean(prefs.displayPlainOutput ?? false),
      displayWorkProcess: Boolean(prefs.displayWorkProcess ?? false),

      // Web tool rendering (UI preference): preview truncation.
      webResultTruncateChars:
        typeof prefs.webResultTruncateChars === "number" && Number.isFinite(prefs.webResultTruncateChars)
          ? Math.trunc(prefs.webResultTruncateChars)
          : 4000
    },

    model: prefs.model ?? "openai-compatible",
    transport: (prefs.transport ?? "sse") as any,

    gpu: { available: null },

    inspectorTab: "events",
    logsByTab: { events: [], tools: [], context: [] }
  };
}
