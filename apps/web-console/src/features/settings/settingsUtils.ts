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
