/**
 * Client-side preference persistence (localStorage).
 *
 * What goes here:
 * - UI/runtime preferences that should survive reloads (theme is handled separately).
 *
 * What does NOT go here:
 * - Secrets / API keys (never store in the browser unless you explicitly accept the risk).
 * - Server startup config (host/port) → stored in TOML on disk via the local backend.
 *
 * Edge cases:
 * - localStorage can throw (privacy mode / disabled storage) → guarded.
 */

export type StoredPrefsV1 = {
  v: 1;

  // Background
  textureDisabled?: boolean;

  // Runtime
  transport?: string;
  model?: string;

  // Plugins (by id)
  plugins?: Record<string, boolean>;
};

const KEY = "eclia-prefs-v1";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readStoredPrefs(): StoredPrefsV1 {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { v: 1 };
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { v: 1 };
    const v = parsed.v;
    if (v !== 1) return { v: 1 };

    const out: StoredPrefsV1 = { v: 1 };

    if (typeof parsed.textureDisabled === "boolean") out.textureDisabled = parsed.textureDisabled;
    if (typeof parsed.transport === "string") out.transport = parsed.transport;
    if (typeof parsed.model === "string") out.model = parsed.model;

    if (isRecord(parsed.plugins)) {
      const map: Record<string, boolean> = {};
      for (const [k, val] of Object.entries(parsed.plugins)) {
        if (typeof val === "boolean") map[k] = val;
      }
      out.plugins = map;
    }

    return out;
  } catch {
    return { v: 1 };
  }
}

export function writeStoredPrefs(next: StoredPrefsV1): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}
