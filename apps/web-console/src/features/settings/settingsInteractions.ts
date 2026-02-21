import type { CodexOAuthProfile, CodexOAuthStatus, ConfigResponse } from "./settingsTypes";

async function readJsonOrNull(r: Response): Promise<any | null> {
  try {
    return await r.json();
  } catch {
    return null;
  }
}

function hintFrom(j: any): string | null {
  return typeof j?.hint === "string" ? j.hint : null;
}

function errFrom(j: any): string | null {
  if (typeof j?.error === "string") return j.error;
  if (typeof j?.message === "string") return j.message;
  return null;
}

/** GET /api/config (dev config service). */
export async function fetchDevConfig(): Promise<ConfigResponse> {
  const r = await fetch("/api/config", { method: "GET" });
  return (await r.json()) as ConfigResponse;
}

/** PUT /api/config (dev config service). */
export async function saveDevConfig(body: any): Promise<ConfigResponse> {
  const r = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return (await r.json()) as ConfigResponse;
}

/** POST /api/native/pick-folder. Returns null when the user cancels. */
export async function pickNativeFolder(): Promise<string | null> {
  const r = await fetch("/api/native/pick-folder", { method: "POST" });
  const j = await readJsonOrNull(r);

  if (!r.ok) {
    const hint = hintFrom(j);
    const err = errFrom(j);
    throw new Error(hint ?? err ?? `Failed to open folder picker (HTTP ${r.status}).`);
  }

  if (j?.ok !== true) {
    // Silent no-op on user cancel.
    const e = typeof j?.error === "string" ? j.error : "";
    if (e === "cancelled") return null;
    const hint = hintFrom(j);
    throw new Error(hint ?? (e || "Folder picker failed."));
  }

  const p = String(j?.path ?? "").trim();
  if (!p) throw new Error("No folder selected.");

  return p;
}

/** GET /api/codex/oauth/status. */
export async function fetchCodexStatus(): Promise<CodexOAuthStatus> {
  const r = await fetch("/api/codex/oauth/status", { method: "GET" });
  const j = await readJsonOrNull(r);

  if (!r.ok) {
    if (r.status === 404) throw new Error("Codex status backend not implemented.");
    const hint = hintFrom(j);
    const err = errFrom(j);
    throw new Error(hint ?? err ?? `Failed to check status (HTTP ${r.status}).`);
  }

  if (j?.ok !== true) {
    const hint = hintFrom(j);
    const err = errFrom(j);
    throw new Error(hint ?? err ?? "Failed to check status.");
  }

  return {
    requires_openai_auth: j?.requires_openai_auth === true,
    account: j?.account && typeof j.account === "object" ? j.account : null,
    models: Array.isArray(j?.models) ? (j.models as string[]) : null
  };
}

/** POST /api/codex/oauth/start. Returns an auth URL string (empty when missing/unparseable). */
export async function startCodexOAuthLogin(profile: CodexOAuthProfile): Promise<string> {
  const r = await fetch("/api/codex/oauth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: { id: profile.id, name: profile.name, model: profile.model } })
  });

  // Be tolerant of non-JSON responses; the caller already handles missing URLs.
  const j = await readJsonOrNull(r);

  if (!r.ok) {
    if (r.status === 404) throw new Error("Codex login backend not implemented.");
    const hint = hintFrom(j);
    const err = errFrom(j);
    throw new Error(hint ?? err ?? `Failed to start login (HTTP ${r.status}).`);
  }

  return typeof j?.url === "string" ? j.url.trim() : "";
}

/** POST /api/codex/oauth/clear. */
export async function clearCodexOAuth(): Promise<void> {
  const r = await fetch("/api/codex/oauth/clear", { method: "POST" });
  const j = await readJsonOrNull(r);

  if (!r.ok) {
    if (r.status === 404) throw new Error("Codex clear backend not implemented.");
    const hint = hintFrom(j);
    const err = errFrom(j);
    throw new Error(hint ?? err ?? `Failed to clear config (HTTP ${r.status}).`);
  }

  if (j?.ok !== true) {
    const hint = hintFrom(j);
    const err = errFrom(j);
    throw new Error(hint ?? err ?? "Failed to clear config.");
  }
}
