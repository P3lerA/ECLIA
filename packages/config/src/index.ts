export type {
  EcliaConfig,
  OpenAICompatProfile,
  AnthropicProfile,
  CodexOAuthProfile,
  EcliaConfigPatch
} from "./types.js";

export type {
  ConfigApiRequestBody,
  ConfigApiConfig,
  ConfigApiSuccessResponse,
  ConfigApiErrorResponse,
  ConfigApiResponse
} from "./config-api-protocol.js";

export type { ParsedRouteKey, RouteKeyDefaults } from "./route-key.js";

export { DEFAULT_ECLIA_CONFIG } from "./types.js";

export type { InferenceProviderId, WebProviderId } from "./provider-defaults.js";

export {
  INFERENCE_PROVIDER_OPENAI_COMPAT,
  INFERENCE_PROVIDER_ANTHROPIC,
  INFERENCE_PROVIDER_CODEX_OAUTH,
  INFERENCE_PROVIDER_IDS,
  DEFAULT_INFERENCE_PROVIDER,
  WEB_PROVIDER_TAVILY,
  WEB_PROVIDER_IDS,
  DEFAULT_WEB_PROVIDER,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  OPENAI_COMPAT_DEFAULT_BASE_URL,
  OPENAI_COMPAT_DEFAULT_MODEL,
  OPENAI_COMPAT_DEFAULT_AUTH_HEADER,
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_DEFAULT_AUTH_HEADER,
  ANTHROPIC_DEFAULT_VERSION,
  CODEX_OAUTH_DEFAULT_MODEL,
  isInferenceProviderId,
  isWebProviderId
} from "./provider-defaults.js";

export { findProjectRoot } from "./root.js";

export {
  ensureSystemInstructionFiles,
  readSystemInstruction,
  renderSystemInstructionTemplate
} from "./system-instruction.js";

export {
  ensureSystemMemoryTemplateFiles,
  readSystemMemoryTemplate,
  renderSystemMemoryTemplate
} from "./system-memory.js";

export {
  ensureLocalConfig,
  loadEcliaConfig,
  writeLocalEcliaConfig
} from "./store.js";

export { preflightListen } from "./preflight.js";

export {
  ROUTE_KEY_OPENAI_COMPAT_PREFIX,
  ROUTE_KEY_ANTHROPIC_COMPAT_PREFIX,
  ROUTE_KEY_ANTHROPIC_LEGACY_PREFIX,
  ROUTE_KEY_CODEX_OAUTH_PREFIX,
  openaiCompatProfileRouteKey,
  anthropicProfileRouteKey,
  codexOAuthProfileRouteKey,
  parseRouteKey,
  canonicalizeRouteKey,
  routeKeyDefaultsFromConfig,
  canonicalizeRouteKeyForConfig
} from "./route-key.js";

export type { InferenceSelection } from "./inference-resolver.js";

export {
  joinUrl,
  resolveUpstreamModel,
  resolveInferenceSelection,
  resolveAnthropicSelection,
  resolveCodexOAuthSelection,
  resolveOpenAICompatSelection
} from "./inference-resolver.js";
