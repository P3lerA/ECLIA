/**
 * Lightweight module-level cache for profile wire format info.
 *
 * Populated on app startup (auth check reads /api/config) and refreshed
 * whenever settings are saved. Used by useSendMessage to validate that
 * computer_use mode is only sent to Responses API profiles.
 */

import { parseRouteKey } from "@eclia/config/route-key";

type ProfileWireFormat = "completion" | "responses";

const wireFormatByProfileId = new Map<string, ProfileWireFormat>();

/**
 * Populate the cache from the raw /api/config response body.
 * Call this on startup and after settings saves.
 */
export function populateConfigCache(rawConfig: any): void {
  wireFormatByProfileId.clear();
  const profiles = rawConfig?.inference?.openai_compat?.profiles;
  if (!Array.isArray(profiles)) {
    console.warn("[configCache] No openai_compat profiles found in config response");
    return;
  }
  for (const p of profiles) {
    const id = String(p?.id ?? "").trim();
    if (!id) continue;
    const wf = String(p?.wire_format ?? "").trim();
    wireFormatByProfileId.set(id, wf === "responses" ? "responses" : "completion");
  }
  console.log(`[configCache] Cached wireFormat for ${wireFormatByProfileId.size} profile(s)`);
}

/**
 * Populate the cache from CfgBase-style profile objects (used after settings save,
 * where the gateway response doesn't echo back the full config).
 */
export function populateConfigCacheFromProfiles(
  profiles: ReadonlyArray<{ id: string; wireFormat: "completion" | "responses" }>
): void {
  wireFormatByProfileId.clear();
  for (const p of profiles) {
    const id = p.id.trim();
    if (!id) continue;
    wireFormatByProfileId.set(id, p.wireFormat);
  }
  console.log(`[configCache] Cached wireFormat for ${wireFormatByProfileId.size} profile(s) (from CfgBase)`);
}

/**
 * Check if the given model route key supports computer use (Responses API).
 *
 * When the cache is empty (not yet populated or population failed), we
 * return true (optimistic) and let the gateway decide. This avoids
 * blocking valid requests due to a stale/missing cache.
 */
export function supportsComputerUse(modelRouteKey: string): boolean {
  const parsed = parseRouteKey(modelRouteKey);
  // Anthropic and Codex never support Responses API
  if (parsed.kind === "anthropic" || parsed.kind === "codex_oauth") return false;
  if (parsed.kind === "openai_compat") {
    const profileId = parsed.profileId;
    if (!profileId) return false;
    // If cache is empty, be optimistic — let the gateway decide.
    if (wireFormatByProfileId.size === 0) return true;
    return wireFormatByProfileId.get(profileId) === "responses";
  }
  return false;
}
