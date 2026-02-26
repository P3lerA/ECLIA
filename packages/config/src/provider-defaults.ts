export const INFERENCE_PROVIDER_OPENAI_COMPAT = "openai_compat" as const;
export const INFERENCE_PROVIDER_ANTHROPIC = "anthropic" as const;
export const INFERENCE_PROVIDER_CODEX_OAUTH = "codex_oauth" as const;

export const INFERENCE_PROVIDER_IDS = [
  INFERENCE_PROVIDER_OPENAI_COMPAT,
  INFERENCE_PROVIDER_ANTHROPIC,
  INFERENCE_PROVIDER_CODEX_OAUTH
] as const;

export type InferenceProviderId = (typeof INFERENCE_PROVIDER_IDS)[number];

const INFERENCE_PROVIDER_SET: ReadonlySet<string> = new Set(INFERENCE_PROVIDER_IDS);

export function isInferenceProviderId(v: unknown): v is InferenceProviderId {
  return typeof v === "string" && INFERENCE_PROVIDER_SET.has(v);
}

export const DEFAULT_INFERENCE_PROVIDER: InferenceProviderId = INFERENCE_PROVIDER_OPENAI_COMPAT;

export const WEB_PROVIDER_TAVILY = "tavily" as const;
export const WEB_PROVIDER_IDS = [WEB_PROVIDER_TAVILY] as const;
export type WebProviderId = (typeof WEB_PROVIDER_IDS)[number];

const WEB_PROVIDER_SET: ReadonlySet<string> = new Set(WEB_PROVIDER_IDS);

export function isWebProviderId(v: unknown): v is WebProviderId {
  return typeof v === "string" && WEB_PROVIDER_SET.has(v);
}

export const DEFAULT_WEB_PROVIDER: WebProviderId = WEB_PROVIDER_TAVILY;

export const DEFAULT_PROFILE_ID = "default" as const;
export const DEFAULT_PROFILE_NAME = "Default" as const;

export const OPENAI_COMPAT_DEFAULT_BASE_URL = "https://api.openai.com/v1" as const;
export const OPENAI_COMPAT_DEFAULT_MODEL = "gpt-5" as const;
export const OPENAI_COMPAT_DEFAULT_AUTH_HEADER = "Authorization" as const;

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com" as const;
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6" as const;
export const ANTHROPIC_DEFAULT_AUTH_HEADER = "x-api-key" as const;
export const ANTHROPIC_DEFAULT_VERSION = "2023-06-01" as const;

export const CODEX_OAUTH_DEFAULT_MODEL = "gpt-5.3-codex" as const;
