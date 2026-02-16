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

  /**
   * Whether to apply context truncation.
   * When false, the UI will send an effectively "unlimited" budget.
   */
  contextLimitEnabled?: boolean;

  /**
   * Approximate context budget (token estimator). Default: 20000.
   * This is a UI preference and is sent to the gateway per request.
   */
  contextTokenLimit?: number;

  /**
   * Tool execution access mode (per UI, persisted locally).
   * - full: allow the gateway to execute tools automatically.
   * - safe: auto-run allowlisted commands, otherwise require user approval.
   */
  execAccessMode?: "full" | "safe";

  /**
   * Whether the UI should keep sessions/messages in sync with the local gateway.
   */
  sessionSyncEnabled?: boolean;

  /**
   * Output rendering preference.
   *
   * When true, the UI prefers "plain" (debug-friendly) rendering:
   * - Tool blocks show the full raw payload (tool_call + tool_result) as JSON.
   * - Thought blocks are shown inline (not collapsed).
   * - (Future) Markdown rendering can be disabled here as well.
   */
  displayPlainOutput?: boolean;

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

    if (typeof (parsed as any).contextLimitEnabled === "boolean") {
      out.contextLimitEnabled = Boolean((parsed as any).contextLimitEnabled);
    }

    if (typeof (parsed as any).contextTokenLimit === "number" && Number.isFinite((parsed as any).contextTokenLimit)) {
      out.contextTokenLimit = Math.trunc((parsed as any).contextTokenLimit);
    }

    if ((parsed as any).execAccessMode === "safe" || (parsed as any).execAccessMode === "full") {
      out.execAccessMode = (parsed as any).execAccessMode;
    }

    if (typeof (parsed as any).sessionSyncEnabled === "boolean") {
      out.sessionSyncEnabled = Boolean((parsed as any).sessionSyncEnabled);
    }

    if (typeof (parsed as any).displayPlainOutput === "boolean") {
      out.displayPlainOutput = Boolean((parsed as any).displayPlainOutput);
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
