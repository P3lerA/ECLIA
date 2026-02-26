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

import { normalizeEnabledToolNames } from "../core/tools/ToolRegistry";

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
   * Sampling temperature override.
   * If omitted, the request does not send an override (provider default).
   */
  temperature?: number;

  /**
   * Nucleus sampling override (top_p).
   * If omitted, the request does not send an override (provider default).
   */
  topP?: number;

  /**
   * Top-k sampling override.
   * Non-standard in OpenAI, but supported by some OpenAI-compatible providers.
   */
  topK?: number;

  /**
   * Output token limit override.
   * If omitted, the request does not send an override (provider default).
   */
  maxOutputTokens?: number;

  /**
   * Tool execution access mode (per UI, persisted locally).
   * - full: allow the gateway to execute tools automatically.
   * - safe: auto-run allowlisted commands, otherwise require user approval.
   */
  toolAccessMode?: "full" | "safe";

  /**
   * Enabled tools exposed to the model.
   * Stored as an ordered list of tool names.
   */
  enabledTools?: string[];

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

  /**
   * Chat rendering preference.
   * - true: show every step (assistant/tool_call/tool_result)
   * - false: show only the final assistant message per user turn
   */
  displayWorkProcess?: boolean;

  /**
   * Web tool result rendering: max characters to preview per item.
   * This is a UI-only preference (does not affect tool execution).
   */
  webResultTruncateChars?: number;

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


    if (typeof (parsed as any).temperature === "number" && Number.isFinite((parsed as any).temperature)) {
      // Clamp to a typical OpenAI-compatible range.
      out.temperature = Math.max(0, Math.min(2, (parsed as any).temperature));
    }

    if (typeof (parsed as any).topP === "number" && Number.isFinite((parsed as any).topP)) {
      // Clamp to a typical OpenAI-compatible range.
      out.topP = Math.max(0, Math.min(1, (parsed as any).topP));
    }

    if (typeof (parsed as any).topK === "number" && Number.isFinite((parsed as any).topK)) {
      out.topK = Math.max(1, Math.min(1000, Math.trunc((parsed as any).topK)));
    }

    if (typeof (parsed as any).maxOutputTokens === "number" && Number.isFinite((parsed as any).maxOutputTokens)) {
      const i = Math.trunc((parsed as any).maxOutputTokens);
      // Backward compatibility: non-positive values are treated as omitted.
      if (i > 0) out.maxOutputTokens = Math.max(1, Math.min(200_000, i));
    }

    if ((parsed as any).toolAccessMode === "safe" || (parsed as any).toolAccessMode === "full") {
      out.toolAccessMode = (parsed as any).toolAccessMode;
    }

    if (Array.isArray((parsed as any).enabledTools)) {
      out.enabledTools = normalizeEnabledToolNames((parsed as any).enabledTools);
    }

    // Backward compat: older builds persisted this under a different key.
    // Keep the legacy key constructed so the previous name is not hard-coded.
    const legacyKey = "exec" + "AccessMode";
    const legacyMode = (parsed as any)[legacyKey];
    if (out.toolAccessMode == null && (legacyMode === "safe" || legacyMode === "full")) {
      out.toolAccessMode = legacyMode;
    }

    if (typeof (parsed as any).sessionSyncEnabled === "boolean") {
      out.sessionSyncEnabled = Boolean((parsed as any).sessionSyncEnabled);
    }

    if (typeof (parsed as any).displayPlainOutput === "boolean") {
      out.displayPlainOutput = Boolean((parsed as any).displayPlainOutput);
    }

    if (typeof (parsed as any).displayWorkProcess === "boolean") {
      out.displayWorkProcess = Boolean((parsed as any).displayWorkProcess);
    }

    if (typeof (parsed as any).webResultTruncateChars === "number" && Number.isFinite((parsed as any).webResultTruncateChars)) {
      out.webResultTruncateChars = Math.trunc((parsed as any).webResultTruncateChars);
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
