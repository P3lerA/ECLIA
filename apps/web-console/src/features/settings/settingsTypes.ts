import type { TransportId } from "../../core/transport/TransportRegistry";
import type { ToolName } from "../../core/tools/ToolRegistry";
import type { ConfigApiConfig, ConfigApiRequestBody, ConfigApiResponse } from "@eclia/config";
import type { WebProviderId } from "@eclia/config/provider-defaults";

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
    provider: WebProviderId;
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
  adapterDiscordGuildWhitelist: string; // UI input only; newline/comma separated; persisted as adapters.discord.guild_ids
  adapterDiscordUserWhitelist: string; // UI input only; newline/comma separated; persisted as adapters.discord.user_whitelist
  adapterDiscordForceGlobalCommands: boolean; // persisted as adapters.discord.force_global_commands

  // Adapters (Discord advanced)
  adapterDiscordDefaultStreamMode: "full" | "final"; // default for /eclia verbose when omitted

  // Adapters (Telegram). Secrets stored in local TOML; token is never read back.
  adapterTelegramEnabled: boolean;
  adapterTelegramBotToken: string; // input only; empty = unchanged
  adapterTelegramUserWhitelist: string; // UI input only; newline/comma separated; persisted as adapters.telegram.user_whitelist
  adapterTelegramGroupWhitelist: string; // UI input only; newline/comma separated; persisted as adapters.telegram.group_whitelist

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
  discordGuildWhitelist: string[];
  discordUserWhitelist: string[];
  discordForceGlobalCommands: boolean;
  discordDefaultStreamMode: "full" | "final";

  telegramEnabled: boolean;
  telegramTokenConfigured: boolean;
  telegramUserWhitelist: string[];
  telegramGroupWhitelist: string[];

  // Web tool
  webActiveProfileId: string;
  webProfiles: Array<{
    id: string;
    name: string;
    provider: WebProviderId;
    projectId: string;
    apiKeyConfigured: boolean;
  }>;

  skillsEnabled: string[];
  skillsAvailable: Array<{ name: string; summary: string }>;
};

export type DevConfig = ConfigApiConfig;
export type ConfigRequestBody = ConfigApiRequestBody;
export type ConfigResponse = ConfigApiResponse;
