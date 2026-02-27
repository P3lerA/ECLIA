import type { CodexOAuthProfile, SettingsDraft } from "./settingsTypes";
import {
  anthropicProfileRouteKey,
  codexOAuthProfileRouteKey,
  openaiCompatProfileRouteKey,
  parseRouteKey
} from "@eclia/config/route-key";

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
 * - Any non-positive number => null (legacy compatibility; treated as "unlimited")
 * - Otherwise => clamp to [1, 200000]
 */
export function parseMaxOutputTokens(s: string): number | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const i = Math.trunc(n);
  // Legacy compatibility: non-positive values mean "unlimited / omitted".
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
  return openaiCompatProfileRouteKey(profileId);
}

export function anthropicProfileRoute(profileId: string): string {
  return anthropicProfileRouteKey(profileId);
}

export function codexProfileRoute(profileId: string): string {
  return codexOAuthProfileRouteKey(profileId);
}

export type ModelRouteOption = {
  group: "OpenAI-compatible" | "Anthropic-compatible" | "Codex OAuth";
  value: string;
  label: string;
};

export function buildModelRouteOptions(
  openaiProfiles: Array<{ id: string; name: string }> | null | undefined,
  anthropicProfiles: Array<{ id: string; name: string }> | null | undefined,
  codexOAuthProfiles: Array<{ id: string; name: string }> | null | undefined
): ModelRouteOption[] {
  const options: ModelRouteOption[] = [];
  const seen = new Set<string>();

  for (const p of openaiProfiles ?? []) {
    const id = String(p.id ?? "").trim();
    if (!id) continue;
    const value = openaiProfileRoute(id);
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      group: "OpenAI-compatible",
      value,
      label: String(p.name ?? "").trim() || "Untitled"
    });
  }

  for (const p of anthropicProfiles ?? []) {
    const id = String(p.id ?? "").trim();
    if (!id) continue;
    const value = anthropicProfileRoute(id);
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      group: "Anthropic-compatible",
      value,
      label: String(p.name ?? "").trim() || "Untitled"
    });
  }

  for (const p of codexOAuthProfiles ?? []) {
    const id = String(p.id ?? "").trim();
    if (!id) continue;
    const value = codexProfileRoute(id);
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      group: "Codex OAuth",
      value,
      label: String(p.name ?? "").trim() || "Untitled"
    });
  }

  return options;
}

export function newLocalId(fallbackPrefix: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
  return uuid ?? `${fallbackPrefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

export function normalizeActiveModel(
  current: string,
  openaiProfiles: Array<{ id: string }> | null | undefined,
  anthropicProfiles: Array<{ id: string }> | null | undefined
): string {
  const k = String(current ?? "").trim();
  const parsed = parseRouteKey(k);

  // Codex routes are managed entirely on the frontend for now.
  if (parsed.kind === "codex_oauth") return parsed.raw;

  const openaiFirst = openaiProfiles && openaiProfiles.length ? openaiProfileRoute(openaiProfiles[0].id) : null;
  const anthropicFirst = anthropicProfiles && anthropicProfiles.length ? anthropicProfileRoute(anthropicProfiles[0].id) : null;

  if (parsed.kind === "openai_compat") {
    const id = String(parsed.profileId ?? "").trim();
    if (!id) return openaiFirst ?? anthropicFirst ?? k;
    if (openaiProfiles?.some((p) => p.id === id)) return k;
    return openaiFirst ?? anthropicFirst ?? k;
  }

  if (parsed.kind === "anthropic") {
    const id = String(parsed.profileId ?? "").trim();
    if (!id) return anthropicFirst ?? openaiFirst ?? k;
    if (anthropicProfiles?.some((p) => p.id === id)) return anthropicProfileRoute(id);
    return anthropicFirst ?? openaiFirst ?? k;
  }

  // Raw model ids and any other values map to the default profile.
  return openaiFirst ?? anthropicFirst ?? k;
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



export function sameAnthropicProfiles(
  draft: SettingsDraft["anthropicProfiles"],
  base: Array<{ id: string; name: string; baseUrl: string; modelId: string; authHeader: string; anthropicVersion: string }>
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
    if (a.anthropicVersion.trim() !== b.anthropicVersion) return false;
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

export function sameEmailListenerAccounts(
  draft: SettingsDraft["pluginEmailListenerAccounts"],
  base: Array<{
    id: string;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    mailbox: string;
    criterion: string;
    model: string;
    notifyKind: "discord" | "telegram";
    notifyId: string;
    startFrom: "now" | "all";
    maxBodyChars: number;
  }>
): boolean {
  if (draft.length !== base.length) return false;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i];
    const b = base[i];

    const portNum = Number(a.port);
    const port = Number.isFinite(portNum) ? Math.trunc(portNum) : 993;

    const maxBodyNum = Number(a.maxBodyChars);
    const maxBodyChars = Number.isFinite(maxBodyNum) ? Math.max(0, Math.trunc(maxBodyNum)) : 12_000;

    if (a.id.trim() !== b.id) return false;
    if (a.host.trim() !== b.host) return false;
    if (port !== b.port) return false;
    if (Boolean(a.secure) !== Boolean(b.secure)) return false;
    if (a.user.trim() !== b.user) return false;

    const mailbox = a.mailbox.trim() || "INBOX";
    if (mailbox !== b.mailbox) return false;

    if (a.criterion.trim() !== b.criterion.trim()) return false;
    if (a.model.trim() !== b.model) return false;
    if (a.notifyKind !== b.notifyKind) return false;
    if (a.notifyId.trim() !== b.notifyId) return false;
    if (a.startFrom !== b.startFrom) return false;
    if (maxBodyChars !== b.maxBodyChars) return false;
  }
  return true;
}
