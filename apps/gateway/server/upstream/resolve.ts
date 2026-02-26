import {
  ANTHROPIC_DEFAULT_AUTH_HEADER,
  OPENAI_COMPAT_DEFAULT_AUTH_HEADER,
  type EcliaConfig
} from "@eclia/config";
import { resolveInferenceSelection } from "@eclia/config";

import { createNoAuthCredential, createStaticApiKeyCredential, type CredentialProvider } from "./credentials.js";
import { createAnthropicProvider } from "./anthropicProvider.js";
import { createCodexAppServerProvider } from "./codexAppServerProvider.js";
import { createOpenAICompatProvider } from "./openaiCompatProvider.js";
import type { UpstreamProvider } from "./provider.js";

export type ResolvedUpstreamBackend = {
  provider: UpstreamProvider;
  credentials: CredentialProvider;
  upstreamModel: string;
};

export function resolveUpstreamBackend(routeModel: string, config: EcliaConfig): ResolvedUpstreamBackend {
  const sel = resolveInferenceSelection(routeModel, config);

  if (sel.kind === "openai_compat") {
    const profile = sel.profile;
    const upstreamModel = sel.upstreamModel;

    const provider = createOpenAICompatProvider({ baseUrl: profile.base_url, upstreamModel });

    const missingMessage = `Missing API key for profile \"${profile.name}\". Set inference.openai_compat.profiles[].api_key in eclia.config.local.toml (or add it in Settings).`;

    const credentials = createStaticApiKeyCredential({
      apiKey: profile.api_key ?? "",
      headerName: profile.auth_header ?? OPENAI_COMPAT_DEFAULT_AUTH_HEADER,
      treatAuthorizationAsBearer: true,
      missingMessage
    });

    return { provider, credentials, upstreamModel };
  }

  if (sel.kind === "anthropic") {
    const profile = sel.profile;
    const upstreamModel = sel.upstreamModel;

    const provider = createAnthropicProvider({
      baseUrl: profile.base_url,
      upstreamModel,
      anthropicVersion: profile.anthropic_version
    });

    const missingMessage = `Missing API key for profile "${profile.name}". Set inference.anthropic.profiles[].api_key in eclia.config.local.toml (or add it in Settings).`;

    const credentials = createStaticApiKeyCredential({
      apiKey: profile.api_key ?? "",
      headerName: profile.auth_header ?? ANTHROPIC_DEFAULT_AUTH_HEADER,
      treatAuthorizationAsBearer: false,
      missingMessage
    });

    return { provider, credentials, upstreamModel };
  }

  // Codex OAuth profile via Codex app-server.
  const profile = sel.profile;
  const upstreamModel = sel.upstreamModel;

  const provider = createCodexAppServerProvider({ upstreamModel });

  const credentials = createNoAuthCredential();

  return { provider, credentials, upstreamModel };
}
