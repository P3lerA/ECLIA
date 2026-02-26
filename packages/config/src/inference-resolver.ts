import type { AnthropicProfile, CodexOAuthProfile, EcliaConfig, OpenAICompatProfile } from "./types.js";
import { DEFAULT_ECLIA_CONFIG } from "./types.js";
import { parseRouteKey } from "./route-key.js";

/**
 * Utility: join base_url with a path (avoid double slashes).
 */
export function joinUrl(baseUrl: string, pathSuffix: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  const p = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
  return `${b}${p}`;
}

/**
 * Resolve the actual upstream model id from a UI route key.
 * The UI uses friendly "route" strings; upstream wants real model ids.
 */
export function resolveUpstreamModel(routeKey: string, config: EcliaConfig): string {
  const k = (routeKey ?? "").trim();
  const sel = resolveInferenceSelection(k, config);
  return sel.upstreamModel;
}

export type InferenceSelection =
  | { kind: "openai_compat"; profile: OpenAICompatProfile; upstreamModel: string }
  | { kind: "anthropic"; profile: AnthropicProfile; upstreamModel: string }
  | { kind: "codex_oauth"; profile: CodexOAuthProfile; upstreamModel: string };

/**
 * Resolve which upstream backend should be used for a given runtime route key.
 *
 * Today we support:
 * - OpenAI-compatible profiles: openai-compatible:<profile-id>
 * - Anthropic profiles: anthropic:<profile-id>
 * - Codex OAuth profiles: codex-oauth:<profile-id>
 */
export function resolveInferenceSelection(routeKey: string, config: EcliaConfig): InferenceSelection {
  const parsed = parseRouteKey(routeKey);

  if (parsed.kind === "codex_oauth") {
    const sel = resolveCodexOAuthSelection(routeKey, config);
    return { kind: "codex_oauth", ...sel };
  }

  if (parsed.kind === "anthropic") {
    const sel = resolveAnthropicSelection(routeKey, config);
    return { kind: "anthropic", ...sel };
  }

  // Default/fallback: OpenAI-compatible (including raw model ids).
  const sel = resolveOpenAICompatSelection(routeKey, config);
  return { kind: "openai_compat", ...sel };
}

export function resolveAnthropicSelection(
  routeKey: string,
  config: EcliaConfig
): { profile: AnthropicProfile; upstreamModel: string } {
  const parsed = parseRouteKey(routeKey);
  const profiles = config.inference.anthropic?.profiles ?? [];

  const fallback = profiles[0] ?? DEFAULT_ECLIA_CONFIG.inference.anthropic.profiles[0];
  if (!fallback) throw new Error("No Anthropic profiles configured");

  if (parsed.kind === "anthropic" && parsed.profileId) {
    const id = parsed.profileId;
    const profile = profiles.find((p) => p.id === id) ?? fallback;
    return { profile, upstreamModel: profile.model };
  }

  if (parsed.kind === "anthropic") {
    return { profile: fallback, upstreamModel: fallback.model };
  }

  return { profile: fallback, upstreamModel: fallback.model };
}

export function resolveCodexOAuthSelection(
  routeKey: string,
  config: EcliaConfig
): { profile: CodexOAuthProfile; upstreamModel: string } {
  const parsed = parseRouteKey(routeKey);
  const profiles = config.inference.codex_oauth?.profiles ?? [];

  const fallback = profiles[0];
  if (!fallback) {
    throw new Error("No Codex OAuth profiles configured");
  }

  if (parsed.kind === "codex_oauth" && parsed.profileId) {
    const id = parsed.profileId;
    const profile = profiles.find((p) => p.id === id) ?? fallback;
    return { profile, upstreamModel: profile.model };
  }

  if (parsed.kind === "codex_oauth") {
    return { profile: fallback, upstreamModel: fallback.model };
  }

  return { profile: fallback, upstreamModel: fallback.model };
}

export function resolveOpenAICompatSelection(
  routeKey: string,
  config: EcliaConfig
): { profile: OpenAICompatProfile; upstreamModel: string } {
  const parsed = parseRouteKey(routeKey);
  const profiles = config.inference.openai_compat.profiles;
  const fallback = profiles[0] ?? DEFAULT_ECLIA_CONFIG.inference.openai_compat.profiles[0];

  if (parsed.kind === "openai_compat" && parsed.profileId) {
    const id = parsed.profileId;
    const profile = profiles.find((p) => p.id === id) ?? fallback;
    return { profile, upstreamModel: profile.model };
  }

  if (parsed.kind === "openai_compat") {
    return { profile: fallback, upstreamModel: fallback.model };
  }

  return { profile: fallback, upstreamModel: parsed.raw };
}
