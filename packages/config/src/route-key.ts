import type { EcliaConfig } from "./types.js";
import { DEFAULT_ECLIA_CONFIG } from "./types.js";
import { DEFAULT_PROFILE_ID } from "./provider-defaults.js";

export const ROUTE_KEY_OPENAI_COMPAT_PREFIX = "openai-compatible";
export const ROUTE_KEY_ANTHROPIC_COMPAT_PREFIX = "anthropic-compatible";
export const ROUTE_KEY_ANTHROPIC_LEGACY_PREFIX = "anthropic";
export const ROUTE_KEY_CODEX_OAUTH_PREFIX = "codex-oauth";

const LEGACY_OPENAI_ROUTE_KEYS = new Set(["router/gateway", "local/ollama"]);

export type RouteKeyDefaults = {
  openaiProfileId?: string;
  anthropicProfileId?: string;
  codexOAuthProfileId?: string;
};

export type ParsedRouteKey =
  | {
      kind: "openai_compat";
      raw: string;
      profileId?: string;
      source:
        | "openai-profile"
        | "openai-shorthand"
        | "openai-legacy-router-gateway"
        | "openai-legacy-local-ollama"
        | "empty";
    }
  | {
      kind: "anthropic";
      raw: string;
      profileId?: string;
      source: "anthropic-profile" | "anthropic-shorthand";
    }
  | {
      kind: "codex_oauth";
      raw: string;
      profileId?: string;
      source: "codex-profile" | "codex-shorthand";
    }
  | {
      kind: "raw_model";
      raw: string;
      source: "raw-model-id";
    };

function cleanProfileId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

export function openaiCompatProfileRouteKey(profileId: string): string {
  const id = cleanProfileId(profileId);
  return id ? `${ROUTE_KEY_OPENAI_COMPAT_PREFIX}:${id}` : ROUTE_KEY_OPENAI_COMPAT_PREFIX;
}

export function anthropicProfileRouteKey(profileId: string): string {
  const id = cleanProfileId(profileId);
  return id ? `${ROUTE_KEY_ANTHROPIC_COMPAT_PREFIX}:${id}` : ROUTE_KEY_ANTHROPIC_COMPAT_PREFIX;
}

export function codexOAuthProfileRouteKey(profileId: string): string {
  const id = cleanProfileId(profileId);
  return id ? `${ROUTE_KEY_CODEX_OAUTH_PREFIX}:${id}` : ROUTE_KEY_CODEX_OAUTH_PREFIX;
}

export function parseRouteKey(routeKey: string): ParsedRouteKey {
  const k = String(routeKey ?? "").trim();

  const codexMatch = k.match(/^codex-oauth(?::([\s\S]+))?$/);
  if (codexMatch) {
    const profileId = cleanProfileId(codexMatch[1]);
    return {
      kind: "codex_oauth",
      raw: k,
      ...(profileId ? { profileId } : {}),
      source: profileId ? "codex-profile" : "codex-shorthand"
    };
  }

  const anthropicMatch = k.match(/^anthropic(?:-compatible)?(?::([\s\S]+))?$/);
  if (anthropicMatch) {
    const profileId = cleanProfileId(anthropicMatch[1]);
    return {
      kind: "anthropic",
      raw: k,
      ...(profileId ? { profileId } : {}),
      source: profileId ? "anthropic-profile" : "anthropic-shorthand"
    };
  }

  const openaiMatch = k.match(/^openai-compatible(?::([\s\S]+))?$/);
  if (openaiMatch) {
    const profileId = cleanProfileId(openaiMatch[1]);
    return {
      kind: "openai_compat",
      raw: k,
      ...(profileId ? { profileId } : {}),
      source: profileId ? "openai-profile" : "openai-shorthand"
    };
  }

  if (!k) {
    return {
      kind: "openai_compat",
      raw: k,
      source: "empty"
    };
  }

  if (LEGACY_OPENAI_ROUTE_KEYS.has(k)) {
    return {
      kind: "openai_compat",
      raw: k,
      source: k === "router/gateway" ? "openai-legacy-router-gateway" : "openai-legacy-local-ollama"
    };
  }

  return {
    kind: "raw_model",
    raw: k,
    source: "raw-model-id"
  };
}

export function routeKeyDefaultsFromConfig(config: EcliaConfig): Required<RouteKeyDefaults> {
  const openaiFallback = DEFAULT_ECLIA_CONFIG.inference.openai_compat.profiles[0]?.id ?? DEFAULT_PROFILE_ID;
  const anthropicFallback = DEFAULT_ECLIA_CONFIG.inference.anthropic.profiles[0]?.id ?? DEFAULT_PROFILE_ID;
  const codexFallback = DEFAULT_ECLIA_CONFIG.inference.codex_oauth.profiles[0]?.id ?? DEFAULT_PROFILE_ID;

  return {
    openaiProfileId: cleanProfileId(config.inference.openai_compat.profiles[0]?.id) ?? openaiFallback,
    anthropicProfileId: cleanProfileId(config.inference.anthropic?.profiles?.[0]?.id) ?? anthropicFallback,
    codexOAuthProfileId: cleanProfileId(config.inference.codex_oauth?.profiles?.[0]?.id) ?? codexFallback
  };
}

export function canonicalizeRouteKey(routeKey: string, defaults?: RouteKeyDefaults): string {
  const parsed = parseRouteKey(routeKey);

  if (parsed.kind === "raw_model") {
    return parsed.raw;
  }

  if (parsed.kind === "openai_compat") {
    const id = cleanProfileId(parsed.profileId) ?? cleanProfileId(defaults?.openaiProfileId);
    return id ? openaiCompatProfileRouteKey(id) : ROUTE_KEY_OPENAI_COMPAT_PREFIX;
  }

  if (parsed.kind === "anthropic") {
    const id = cleanProfileId(parsed.profileId) ?? cleanProfileId(defaults?.anthropicProfileId);
    return id ? anthropicProfileRouteKey(id) : ROUTE_KEY_ANTHROPIC_COMPAT_PREFIX;
  }

  const id = cleanProfileId(parsed.profileId) ?? cleanProfileId(defaults?.codexOAuthProfileId);
  return id ? codexOAuthProfileRouteKey(id) : ROUTE_KEY_CODEX_OAUTH_PREFIX;
}

export function canonicalizeRouteKeyForConfig(routeKey: string, config: EcliaConfig): string {
  return canonicalizeRouteKey(routeKey, routeKeyDefaultsFromConfig(config));
}
