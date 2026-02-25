import type { CodexOAuthProfile, SettingsDraft } from "./settingsTypes";

export function normalizeDiscordStreamMode(v: unknown): "full" | "final" {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "full" ? "full" : "final";
}

export function isValidPort(s: string): boolean {
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  const i = Math.trunc(n);
  return i >= 1 && i <= 65535;
}

export function portNumber(s: string): number | null {
  if (!isValidPort(s)) return null;
  return Math.trunc(Number(s));
}

export function parseContextLimit(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 20000;
  return Math.max(256, Math.min(1_000_000, Math.trunc(n)));
}

export function parseWebResultTruncateChars(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 4000;
  return Math.max(200, Math.min(200_000, Math.trunc(n)));
}

function clampFloat(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Parse optional temperature input.
 *
 * - Empty string => null (omit from request; provider default)
 * - Otherwise => clamp to [0, 2] and round to 3 decimals
 */
export function parseTemperature(s: string): number | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const v = clampFloat(n, 0, 2);
  return Math.round(v * 1000) / 1000;
}

/**
 * Parse optional top_p input.
 *
 * - Empty string => null (omit from request; provider default)
 * - Otherwise => clamp to [0, 1] and round to 3 decimals
 */
export function parseTopP(s: string): number | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const v = clampFloat(n, 0, 1);
  return Math.round(v * 1000) / 1000;
}

/**
 * Parse optional top_k input.
 *
 * - Empty string => null (omit from request; provider default)
 * - Otherwise => clamp to [1, 1000]
 */
export function parseTopK(s: string): number | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const i = Math.trunc(n);
  if (i < 1) return 1;
  if (i > 1000) return 1000;
  return i;
}

/**
 * Parse optional max output tokens.
 *
 * - Empty string => null (omit from request; provider default)
 * - -1 / 0 / any non-positive number => null (treat as "unlimited")
 * - Otherwise => clamp to [1, 200000]
 */
export function parseMaxOutputTokens(s: string): number | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const i = Math.trunc(n);
  // Convention: -1 means "unlimited".
  if (i <= 0) return null;
  if (i > 200000) return 200000;
  return i;
}

export function normalizeGuildIds(input: string): string[] {
  const raw = String(input ?? "")
    .split(/[\n\r,\t\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function openaiProfileRoute(profileId: string): string {
  return `openai-compatible:${profileId}`;
}

export function codexProfileRoute(profileId: string): string {
  return `codex-oauth:${profileId}`;
}

export function newLocalId(fallbackPrefix: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
  return uuid ?? `${fallbackPrefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

export function normalizeActiveModel(current: string, profiles: Array<{ id: string }> | null | undefined): string {
  const k = String(current ?? "").trim();

  // Codex routes are managed entirely on the frontend for now. Preserve them.
  if (/^codex-oauth(?::|$)/.test(k)) return k;

  if (!profiles || profiles.length === 0) return k;

  const first = openaiProfileRoute(profiles[0].id);

  const m = k.match(/^openai-compatible:(.+)$/);
  if (m) {
    const id = String(m[1] ?? "").trim();
    if (profiles.some((p) => p.id === id)) return k;
    return first;
  }

  // Legacy route keys and any other values map to the default profile.
  return first;
}

export function sameOpenAICompatProfiles(
  draft: SettingsDraft["inferenceProfiles"],
  base: Array<{ id: string; name: string; baseUrl: string; modelId: string; authHeader: string }>
): boolean {
  if (draft.length !== base.length) return false;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i];
    const b = base[i];
    if (a.id !== b.id) return false;
    if (a.name.trim() !== b.name) return false;
    if (a.baseUrl.trim() !== b.baseUrl) return false;
    if (a.modelId.trim() !== b.modelId) return false;
    if (a.authHeader.trim() !== b.authHeader) return false;
  }
  return true;
}

export function sameCodexOAuthProfiles(draft: SettingsDraft["codexOAuthProfiles"], base: CodexOAuthProfile[]): boolean {
  if (draft.length !== base.length) return false;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i];
    const b = base[i];
    if (a.id !== b.id) return false;
    if (a.name.trim() !== b.name) return false;
    if (a.model.trim() !== b.model) return false;
  }
  return true;
}

export function sameWebProfiles(
  draft: SettingsDraft["webProfiles"],
  base: Array<{ id: string; name: string; provider: string; projectId: string }>
): boolean {
  if (draft.length !== base.length) return false;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i];
    const b = base[i];
    if (a.id !== b.id) return false;
    if (a.name.trim() !== b.name) return false;
    if (a.provider.trim() !== b.provider) return false;
    if (a.projectId.trim() !== b.projectId) return false;
  }
  return true;
}
