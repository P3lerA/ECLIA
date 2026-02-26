import type { TransportId } from "../../core/transport/TransportRegistry";
import type { ToolName } from "../../core/tools/ToolRegistry";

export type CodexOAuthProfile = {
  id: string;
  name: string;
  model: string;
};

export type CodexOAuthStatus = {
  requires_openai_auth: boolean;
  account: null | {
    type: string;
    email?: string;
    planType?: string;
  };
  models: string[] | null;
};

export type SettingsDraft = {
  textureDisabled: boolean;
  sessionSyncEnabled: boolean;
  displayPlainOutput: boolean;
  enabledTools: ToolName[];
  debugCaptureUpstreamRequests: boolean;
  debugParseAssistantOutput: boolean;
  transport: TransportId;
  model: string;
  contextTokenLimit: string;
  contextLimitEnabled: boolean;

  // Inference sampling overrides (runtime; persisted locally).
  // Empty string => omit from request (use provider defaults).
  temperature: string;
  topP: string;
  topK: string;

  // Output limit override (runtime; persisted locally).
  // Empty string => omit from request (use provider defaults / unlimited).
  maxOutputTokens: string;

  // Web tool: UI-only rendering preference.
  webResultTruncateChars: string; // keep as string for input UX

  // Web tool: provider profiles (dev-only; written to eclia.config.local.toml).
  // Secrets are stored in local TOML; keys are never read back.
  webActiveProfileId: string;
  webProfiles: Array<{
    id: string;
    name: string;
    provider: string;
    apiKey: string; // input only; empty = unchanged
    projectId: string;
  }>;

  // Dev-only (written to eclia.config.local.toml via the local backend).
  consoleHost: string;
  consolePort: string; // keep as string for input UX

  // Dev-only persona placeholders used by _system.local.md template rendering.
  userPreferredName: string;
  assistantName: string;

  // Inference (OpenAI-compatible).
  // Secrets are stored in local TOML; keys are never read back.
  inferenceProfiles: Array<{
    id: string;
    name: string;
    baseUrl: string;
    modelId: string;
    authHeader: string;
    apiKey: string; // input only; empty = unchanged
  }>;


  // Inference (Anthropic-compatible).
  // Secrets are stored in local TOML; keys are never read back.
  anthropicProfiles: Array<{
    id: string;
    name: string;
    baseUrl: string;
    modelId: string;
    authHeader: string;
    anthropicVersion: string;
    apiKey: string; // input only; empty = unchanged
  }>;

  // Codex OAuth (Codex app-server managed ChatGPT login)
  codexOAuthProfiles: CodexOAuthProfile[];

  // Inference advanced: injected as the ONLY role=system message for all providers.
  inferenceSystemInstruction: string;

  // Codex local state directory override (mapped to gateway's ECLIA_CODEX_HOME / CODEX_HOME).
  codexHomeOverrideEnabled: boolean;
  codexHomeOverridePath: string;

  // Adapters (Discord). Secrets stored in local TOML; token is never read back.
  adapterDiscordEnabled: boolean;
  adapterDiscordAppId: string; // application id / client id (non-secret)
  adapterDiscordBotToken: string; // input only; empty = unchanged
  adapterDiscordGuildIds: string; // UI input only; newline/comma separated; persisted as adapters.discord.guild_ids

  // Adapters (Discord advanced)
  adapterDiscordDefaultStreamMode: "full" | "final"; // default for /eclia verbose when omitted

  // Skills (dev-only; stored in eclia.config.local.toml)
  skillsEnabled: string[];
};

export type OpenAICompatProfileBase = {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  authHeader: string;
  apiKeyConfigured: boolean;
};


export type AnthropicProfileBase = {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  authHeader: string;
  anthropicVersion: string;
  apiKeyConfigured: boolean;
};

export type CfgBase = {
  host: string;
  port: number;
  codexHome: string;
  userPreferredName: string;
  assistantName: string;
  debugCaptureUpstreamRequests: boolean;
  debugParseAssistantOutput: boolean;
  systemInstruction: string;
  openaiCompatProfiles: OpenAICompatProfileBase[];
  anthropicProfiles: AnthropicProfileBase[];
  codexOAuthProfiles: CodexOAuthProfile[];
  discordEnabled: boolean;
  discordAppId: string;
  discordTokenConfigured: boolean;
  discordGuildIds: string[];
  discordDefaultStreamMode: "full" | "final";

  // Web tool
  webActiveProfileId: string;
  webProfiles: Array<{
    id: string;
    name: string;
    provider: string;
    projectId: string;
    apiKeyConfigured: boolean;
  }>;

  skillsEnabled: string[];
  skillsAvailable: Array<{ name: string; summary: string }>;
};

export type DevConfig = {
  codex_home?: string;
  console: { host: string; port: number };
  api?: { port: number };
  persona?: {
    user_preferred_name?: string;
    assistant_name?: string;
  };
  debug?: { capture_upstream_requests?: boolean; parse_assistant_output?: boolean };
  skills?: {
    enabled?: string[];
    available?: Array<{ name?: string; summary?: string }>;
  };
  inference?: {
    system_instruction?: string;
    provider?: string;
    openai_compat?: {
      profiles?: Array<{
        id: string;
        name?: string;
        base_url?: string;
        model?: string;
        auth_header?: string;
        api_key_configured?: boolean;
      }>;
    };


    anthropic?: {
      profiles?: Array<{
        id: string;
        name?: string;
        base_url?: string;
        model?: string;
        auth_header?: string;
        anthropic_version?: string;
        api_key_configured?: boolean;
      }>;
    };

    codex_oauth?: {
      profiles?: Array<{
        id: string;
        name?: string;
        model?: string;
      }>;
    };
  };
  adapters?: {
    discord?: {
      enabled?: boolean;
      app_id?: string;
      guild_ids?: string[];
      default_stream_mode?: string;
      app_id_configured?: boolean;
      bot_token_configured?: boolean;
    };
  };

  tools?: {
    web?: {
      active_profile?: string;
      profiles?: Array<{
        id: string;
        name?: string;
        provider?: string;
        project_id?: string;
        api_key_configured?: boolean;
      }>;
    };
  };
};

export type ConfigResponse =
  | { ok: true; config: DevConfig; restartRequired?: boolean; warning?: string }
  | { ok: false; error: string; hint?: string };
