import type { CfgBase, CodexOAuthProfile, DevConfig, SettingsDraft } from "./settingsTypes";
import {
  ANTHROPIC_DEFAULT_AUTH_HEADER,
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_DEFAULT_VERSION,
  CODEX_OAUTH_DEFAULT_MODEL,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_WEB_PROVIDER,
  OPENAI_COMPAT_DEFAULT_AUTH_HEADER,
  OPENAI_COMPAT_DEFAULT_BASE_URL,
  OPENAI_COMPAT_DEFAULT_MODEL,
  isWebProviderId
} from "@eclia/config/provider-defaults";
import { normalizeDiscordStreamMode, normalizeGuildIds, sameStringArray } from "./settingsUtils";

const DEFAULT_OPENAI_PROFILE = {
  base_url: OPENAI_COMPAT_DEFAULT_BASE_URL,
  model: OPENAI_COMPAT_DEFAULT_MODEL,
  auth_header: OPENAI_COMPAT_DEFAULT_AUTH_HEADER
} as const;

const DEFAULT_ANTHROPIC_PROFILE = {
  base_url: ANTHROPIC_DEFAULT_BASE_URL,
  model: ANTHROPIC_DEFAULT_MODEL,
  auth_header: ANTHROPIC_DEFAULT_AUTH_HEADER,
  anthropic_version: ANTHROPIC_DEFAULT_VERSION
} as const;

const DEFAULT_CODEX_MODEL = CODEX_OAUTH_DEFAULT_MODEL;

/**
 * Convert raw dev config (from /api/config) into a normalized, UI-friendly base model.
 * This mirrors the previous in-SettingsView parsing logic.
 */
export function devConfigToCfgBase(config: DevConfig): CfgBase {
  const rawHost = String(config.console?.host ?? "127.0.0.1").trim();
  const host = rawHost === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const port = config.console?.port ?? 5173;
  const codexHome = String((config as any).codex_home ?? "").trim();
  const userPreferredName = String((config as any)?.persona?.user_preferred_name ?? "").trim();
  const assistantName = String((config as any)?.persona?.assistant_name ?? "").trim();
  const debugCaptureUpstreamRequests = Boolean((config as any)?.debug?.capture_upstream_requests ?? false);
  const debugParseAssistantOutput = Boolean((config as any)?.debug?.parse_assistant_output ?? false);
  const systemInstruction = String((config.inference as any)?.system_instruction ?? "");

  const inf = config.inference?.openai_compat ?? {};
  const rawProfiles = Array.isArray((inf as any).profiles) ? ((inf as any).profiles as any[]) : [];
  const profiles: CfgBase["openaiCompatProfiles"] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < rawProfiles.length; i++) {
    const p = rawProfiles[i] ?? {};
    const id = String(p.id ?? "").trim();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const name = String(p.name ?? "").trim() || `Profile ${i + 1}`;
    const baseUrl = String(p.base_url ?? DEFAULT_OPENAI_PROFILE.base_url).trim() || DEFAULT_OPENAI_PROFILE.base_url;
    const modelId = String(p.model ?? DEFAULT_OPENAI_PROFILE.model).trim() || DEFAULT_OPENAI_PROFILE.model;
    const authHeader = String(p.auth_header ?? DEFAULT_OPENAI_PROFILE.auth_header).trim() || DEFAULT_OPENAI_PROFILE.auth_header;
    const apiKeyConfigured = Boolean(p.api_key_configured);

    profiles.push({ id, name, baseUrl, modelId, authHeader, apiKeyConfigured });
  }

  if (profiles.length === 0) {
    profiles.push({
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      baseUrl: DEFAULT_OPENAI_PROFILE.base_url,
      modelId: DEFAULT_OPENAI_PROFILE.model,
      authHeader: DEFAULT_OPENAI_PROFILE.auth_header,
      apiKeyConfigured: false
    });
  }

  const anth = (config.inference as any)?.anthropic ?? {};
  const rawAnthropicProfiles = Array.isArray((anth as any).profiles) ? ((anth as any).profiles as any[]) : [];
  const anthropicProfiles: CfgBase["anthropicProfiles"] = [];
  const seenAnthropicIds = new Set<string>();

  for (let i = 0; i < rawAnthropicProfiles.length; i++) {
    const p = rawAnthropicProfiles[i] ?? {};
    const id = String(p.id ?? "").trim();
    if (!id || seenAnthropicIds.has(id)) continue;
    seenAnthropicIds.add(id);

    const name = String(p.name ?? "").trim() || `Profile ${i + 1}`;
    const baseUrl = String(p.base_url ?? DEFAULT_ANTHROPIC_PROFILE.base_url).trim() || DEFAULT_ANTHROPIC_PROFILE.base_url;
    const modelId = String(p.model ?? DEFAULT_ANTHROPIC_PROFILE.model).trim() || DEFAULT_ANTHROPIC_PROFILE.model;
    const authHeader = String(p.auth_header ?? DEFAULT_ANTHROPIC_PROFILE.auth_header).trim() || DEFAULT_ANTHROPIC_PROFILE.auth_header;
    const anthropicVersion = String(p.anthropic_version ?? DEFAULT_ANTHROPIC_PROFILE.anthropic_version).trim() || DEFAULT_ANTHROPIC_PROFILE.anthropic_version;
    const apiKeyConfigured = Boolean(p.api_key_configured);

    anthropicProfiles.push({ id, name, baseUrl, modelId, authHeader, anthropicVersion, apiKeyConfigured });
  }

  if (anthropicProfiles.length === 0) {
    anthropicProfiles.push({
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      baseUrl: DEFAULT_ANTHROPIC_PROFILE.base_url,
      modelId: DEFAULT_ANTHROPIC_PROFILE.model,
      authHeader: DEFAULT_ANTHROPIC_PROFILE.auth_header,
      anthropicVersion: DEFAULT_ANTHROPIC_PROFILE.anthropic_version,
      apiKeyConfigured: false
    });
  }


  const disc = config.adapters?.discord ?? {};
  const discordEnabled = Boolean((disc as any).enabled ?? false);
  const discordAppId = String((disc as any).app_id ?? "").trim();
  const discordTokenConfigured = Boolean((disc as any).bot_token_configured);
  const discordGuildWhitelist = Array.isArray((disc as any).guild_ids)
    ? (disc as any).guild_ids.map((x: any) => String(x).trim()).filter(Boolean)
    : [];
  const discordUserWhitelist = Array.isArray((disc as any).user_whitelist)
    ? (disc as any).user_whitelist.map((x: any) => String(x).trim()).filter(Boolean)
    : [];
  const discordForceGlobalCommands = Boolean((disc as any).force_global_commands ?? false);
  const discordDefaultStreamMode = normalizeDiscordStreamMode((disc as any).default_stream_mode);

  const tg = (config.adapters as any)?.telegram ?? {};
  const telegramEnabled = Boolean((tg as any).enabled ?? false);
  const telegramTokenConfigured = Boolean((tg as any).bot_token_configured);
  const telegramUserWhitelist = Array.isArray((tg as any).user_whitelist)
    ? (tg as any).user_whitelist.map((x: any) => String(x).trim()).filter(Boolean)
    : [];
  const telegramGroupWhitelist = Array.isArray((tg as any).group_whitelist)
    ? (tg as any).group_whitelist.map((x: any) => String(x).trim()).filter(Boolean)
    : [];

  const emailListenerEnabled = Boolean((config as any)?.plugins?.listener?.email?.enabled ?? false);
  const emailListenerTriagePrompt = String((config as any)?.plugins?.listener?.email?.triage_prompt ?? "");
  const emailAccountsRaw = Array.isArray((config as any)?.plugins?.listener?.email?.accounts)
    ? (((config as any).plugins.listener.email.accounts as any[]) ?? [])
    : [];

  const emailListenerAccounts = emailAccountsRaw
    .map((a) => {
      const id = String(a?.id ?? "").trim();
      if (!id) return null;

      const notifyKindRaw = String(a?.notify?.kind ?? "").trim().toLowerCase();
      const notifyKind: "discord" | "telegram" = notifyKindRaw === "telegram" ? "telegram" : "discord";
      const notifyId =
        notifyKind === "telegram" ? String(a?.notify?.chat_id ?? "").trim() : String(a?.notify?.channel_id ?? "").trim();

      const portNum = Number(a?.port);
      const port = Number.isFinite(portNum) ? Math.trunc(portNum) : 993;

      const maxBodyNum = Number(a?.max_body_chars);
      const maxBodyChars = Number.isFinite(maxBodyNum) ? Math.max(0, Math.trunc(maxBodyNum)) : 12_000;

      const startFrom: "now" = "now";

      return {
        id,
        host: String(a?.host ?? "").trim(),
        port,
        secure: Boolean(a?.secure ?? true),
        user: String(a?.user ?? "").trim(),
        mailbox: String(a?.mailbox ?? "INBOX").trim() || "INBOX",
        criterion: String(a?.criterion ?? ""),
        model: typeof a?.model === "string" ? String(a.model) : "",
        notifyKind,
        notifyId,
        startFrom,
        maxBodyChars,
        passConfigured: Boolean(a?.pass_configured ?? false)
      };
    })
    .filter(Boolean) as CfgBase["emailListenerAccounts"];

  const web = (config as any)?.tools?.web ?? {};
  const rawWebProfiles = Array.isArray((web as any).profiles) ? ((web as any).profiles as any[]) : [];
  const webProfiles: CfgBase["webProfiles"] = [];
  const seenWebIds = new Set<string>();

  for (let i = 0; i < rawWebProfiles.length; i++) {
    const p = rawWebProfiles[i] ?? {};
    const id = String(p.id ?? "").trim();
    if (!id || seenWebIds.has(id)) continue;
    seenWebIds.add(id);

    const name = String(p.name ?? "").trim() || `Profile ${i + 1}`;
    const rawProvider = String(p.provider ?? "").trim();
    const provider = isWebProviderId(rawProvider) ? rawProvider : DEFAULT_WEB_PROVIDER;
    const projectId = String(p.project_id ?? "").trim();
    const apiKeyConfigured = Boolean(p.api_key_configured);

    webProfiles.push({ id, name, provider, projectId, apiKeyConfigured });
  }

  if (webProfiles.length === 0) {
    webProfiles.push({
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      provider: DEFAULT_WEB_PROVIDER,
      projectId: "",
      apiKeyConfigured: false
    });
  }

  let webActiveProfileId = String((web as any).active_profile ?? "").trim() || "";
  if (!webProfiles.some((p) => p.id === webActiveProfileId)) {
    webActiveProfileId = webProfiles[0]?.id ?? DEFAULT_PROFILE_ID;
  }

  const codex = (config.inference as any)?.codex_oauth ?? {};
  const rawCodexProfiles = Array.isArray((codex as any).profiles) ? ((codex as any).profiles as any[]) : [];

  // ECLIA supports a single Codex OAuth profile (Codex auth is global).
  // If multiple profiles are present, we keep the first one.
  let codexProfile: CodexOAuthProfile | null = null;
  for (let i = 0; i < rawCodexProfiles.length; i++) {
    const p = rawCodexProfiles[i] ?? {};
    const name = String(p.name ?? "").trim();
    const model = String(p.model ?? "").trim();
    if (!model) continue;
    codexProfile = {
      id: DEFAULT_PROFILE_ID,
      name: name || DEFAULT_PROFILE_NAME,
      model: model || DEFAULT_CODEX_MODEL
    };
    break;
  }

  if (!codexProfile) {
    codexProfile = { id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, model: DEFAULT_CODEX_MODEL };
  }

  const codexProfiles: CodexOAuthProfile[] = [codexProfile];

  const skillsEnabled = Array.isArray((config as any)?.skills?.enabled)
    ? ((config as any).skills.enabled as any[]).map((x: any) => String(x).trim()).filter(Boolean)
    : [];
  skillsEnabled.sort((a, b) => a.localeCompare(b));

  const rawAvail = Array.isArray((config as any)?.skills?.available) ? ((config as any).skills.available as any[]) : [];
  const skillsAvailable: Array<{ name: string; summary: string }> = [];
  const seenSkills = new Set<string>();
  for (const row of rawAvail) {
    const name = String((row as any)?.name ?? "").trim();
    if (!name || seenSkills.has(name)) continue;
    seenSkills.add(name);
    const summary = String((row as any)?.summary ?? "").trim();
    skillsAvailable.push({ name, summary });
  }
  skillsAvailable.sort((a, b) => a.name.localeCompare(b.name));

  return {
    host,
    port,
    codexHome,
    userPreferredName,
    assistantName,
    debugCaptureUpstreamRequests,
    debugParseAssistantOutput,
    systemInstruction,
    openaiCompatProfiles: profiles,
    anthropicProfiles,
    codexOAuthProfiles: codexProfiles,

    discordEnabled,
    discordAppId,
    discordTokenConfigured,
    discordGuildWhitelist,
    discordUserWhitelist,
    discordForceGlobalCommands,
    discordDefaultStreamMode,

    telegramEnabled,
    telegramTokenConfigured,
    telegramUserWhitelist,
    telegramGroupWhitelist,

    emailListenerEnabled,
    emailListenerTriagePrompt,
    emailListenerAccounts,

    webActiveProfileId,
    webProfiles,

    skillsEnabled,
    skillsAvailable
  };
}

export type BuildDevConfigPatchArgs = {
  draft: SettingsDraft;
  cfgBase: CfgBase;

  dirtyDevCodexHome: boolean;
  dirtyDevPersona: boolean;
  dirtyDevHostPort: boolean;
  hostPortValid: boolean;
  dirtyDevDebug: boolean;
  dirtyDevInference: boolean;
  inferenceValid: boolean;
  dirtyDevDiscord: boolean;
  discordValid: boolean;

  dirtyDevTelegram: boolean;
  telegramValid: boolean;

  dirtyDevEmailListener: boolean;
  emailListenerValid: boolean;

  dirtyDevWeb: boolean;
  webValid: boolean;
  dirtyDevSkills: boolean;
};

/**
 * Build a minimal patch body for PUT /api/config based on dirty flags.
 * Throws when invalid inputs are being saved (mirrors previous behavior).
 */
export function buildDevConfigPatch(args: BuildDevConfigPatchArgs): any {
  const {
    draft,
    cfgBase,
    dirtyDevCodexHome,
    dirtyDevPersona,
    dirtyDevHostPort,
    hostPortValid,
    dirtyDevDebug,
    dirtyDevInference,
    inferenceValid,
    dirtyDevDiscord,
    discordValid,
    dirtyDevTelegram,
    telegramValid,
    dirtyDevEmailListener,
    emailListenerValid,
    dirtyDevWeb,
    webValid,
    dirtyDevSkills
  } = args;

  const body: any = {};

  if (dirtyDevCodexHome) {
    body.codex_home = draft.codexHomeOverrideEnabled ? draft.codexHomeOverridePath.trim() : "";
  }

  if (dirtyDevPersona) {
    body.persona = {
      user_preferred_name: draft.userPreferredName.trim(),
      assistant_name: draft.assistantName.trim()
    };
  }

  if (dirtyDevHostPort) {
    if (!hostPortValid) throw new Error("Invalid host/port.");
    body.console = {
      host: draft.consoleHost.trim(),
      port: Number(draft.consolePort)
    };
  }

  if (dirtyDevDebug) {
    body.debug = {
      capture_upstream_requests: Boolean(draft.debugCaptureUpstreamRequests),
      parse_assistant_output: Boolean(draft.debugParseAssistantOutput)
    };
  }

  if (dirtyDevInference) {
    if (!inferenceValid) throw new Error("Invalid inference profile settings.");

    const inf: any = {
      system_instruction: draft.inferenceSystemInstruction,
      openai_compat: {
        profiles: draft.inferenceProfiles.map((p) => ({
          id: p.id,
          name: p.name.trim(),
          base_url: p.baseUrl.trim(),
          model: p.modelId.trim(),
          auth_header: p.authHeader.trim() || OPENAI_COMPAT_DEFAULT_AUTH_HEADER,
          ...(p.apiKey.trim().length ? { api_key: p.apiKey.trim() } : {})
        }))
      },
      anthropic: {
        profiles: draft.anthropicProfiles.map((p) => ({
          id: p.id,
          name: p.name.trim(),
          base_url: p.baseUrl.trim(),
          model: p.modelId.trim(),
          auth_header: p.authHeader.trim() || ANTHROPIC_DEFAULT_AUTH_HEADER,
          anthropic_version: p.anthropicVersion.trim() || ANTHROPIC_DEFAULT_VERSION,
          ...(p.apiKey.trim().length ? { api_key: p.apiKey.trim() } : {})
        }))
      },

      codex_oauth: {
        profiles: draft.codexOAuthProfiles.slice(0, 1).map((p) => ({
          id: DEFAULT_PROFILE_ID,
          name: p.name.trim(),
          model: p.model.trim()
        }))
      }
    };

    body.inference = inf;
  }

  if (dirtyDevDiscord) {
    if (!discordValid) throw new Error("Discord adapter enabled but missing bot token or Application ID.");
    const appId = draft.adapterDiscordAppId.trim();
    const guildWhitelist = normalizeGuildIds(draft.adapterDiscordGuildWhitelist);
    const guildWhitelistDirty = !sameStringArray(guildWhitelist, cfgBase.discordGuildWhitelist);
    const userWhitelist = normalizeGuildIds(draft.adapterDiscordUserWhitelist);
    const userWhitelistDirty = !sameStringArray(userWhitelist, cfgBase.discordUserWhitelist);
    const forceGlobalCommandsDirty = draft.adapterDiscordForceGlobalCommands !== cfgBase.discordForceGlobalCommands;
    const streamModeDirty = draft.adapterDiscordDefaultStreamMode !== cfgBase.discordDefaultStreamMode;
    body.adapters = {
      discord: {
        enabled: Boolean(draft.adapterDiscordEnabled),
        // app_id is optional; empty means unchanged.
        ...(appId.length && appId !== cfgBase.discordAppId ? { app_id: appId } : {}),
        // bot_token is optional; empty means unchanged.
        ...(draft.adapterDiscordBotToken.trim().length ? { bot_token: draft.adapterDiscordBotToken.trim() } : {}),
        ...(guildWhitelistDirty ? { guild_ids: guildWhitelist } : {}),
        ...(userWhitelistDirty ? { user_whitelist: userWhitelist } : {}),
        ...(forceGlobalCommandsDirty ? { force_global_commands: Boolean(draft.adapterDiscordForceGlobalCommands) } : {}),
        ...(streamModeDirty ? { default_stream_mode: draft.adapterDiscordDefaultStreamMode } : {})
      }
    };
  }

  if (dirtyDevTelegram) {
    if (!telegramValid) throw new Error("Telegram adapter enabled but missing bot token or user whitelist.");
    const userWhitelist = normalizeGuildIds(draft.adapterTelegramUserWhitelist);
    const userWhitelistDirty = !sameStringArray(userWhitelist, cfgBase.telegramUserWhitelist);
    const groupWhitelist = normalizeGuildIds(draft.adapterTelegramGroupWhitelist);
    const groupWhitelistDirty = !sameStringArray(groupWhitelist, cfgBase.telegramGroupWhitelist);

    body.adapters = {
      ...(body.adapters ?? {}),
      telegram: {
        enabled: Boolean(draft.adapterTelegramEnabled),
        ...(draft.adapterTelegramBotToken.trim().length ? { bot_token: draft.adapterTelegramBotToken.trim() } : {}),
        ...(userWhitelistDirty ? { user_whitelist: userWhitelist } : {}),
        ...(groupWhitelistDirty ? { group_whitelist: groupWhitelist } : {})
      }
    };
  }

  if (dirtyDevEmailListener) {
    if (!emailListenerValid) throw new Error("Email listener enabled but missing required account fields.");

    body.plugins = {
      listener: {
        email: {
          enabled: Boolean(draft.pluginEmailListenerEnabled),
          triage_prompt: draft.pluginEmailListenerTriagePrompt,
          accounts: draft.pluginEmailListenerAccounts.map((a) => {
            const portNum = Number(a.port);
            const port = Number.isFinite(portNum) ? Math.trunc(portNum) : 993;

            const maxBodyNum = Number(a.maxBodyChars);
            const max_body_chars = Number.isFinite(maxBodyNum) ? Math.max(0, Math.trunc(maxBodyNum)) : undefined;

            const notifyId = a.notifyId.trim();
            const notify =
              a.notifyKind === "telegram" ? { kind: "telegram", chat_id: notifyId } : { kind: "discord", channel_id: notifyId };

            return {
              id: a.id.trim(),
              host: a.host.trim(),
              port,
              secure: Boolean(a.secure),
              user: a.user.trim(),
              ...(a.pass.trim().length ? { pass: a.pass.trim() } : {}),
              ...(a.mailbox.trim().length ? { mailbox: a.mailbox.trim() } : {}),
              criterion: a.criterion,
              ...(a.model.trim().length ? { model: a.model.trim() } : {}),
              notify,
              start_from: "now",
              ...(typeof max_body_chars === "number" ? { max_body_chars } : {})
            };
          })
        }
      }
    };
  }

  if (dirtyDevWeb) {
    if (!webValid) throw new Error("Invalid web provider profile settings.");

    body.tools = {
      web: {
        active_profile: draft.webActiveProfileId,
        profiles: draft.webProfiles.map((p) => ({
          id: p.id,
          name: p.name.trim(),
          provider: p.provider,
          project_id: p.projectId.trim(),
          ...(p.apiKey.trim().length ? { api_key: p.apiKey.trim() } : {})
        }))
      }
    };
  }

  if (dirtyDevSkills) {
    body.skills = {
      enabled: Array.isArray(draft.skillsEnabled) ? draft.skillsEnabled : []
    };
  }

  return body;
}

/**
 * After a successful dev-config save, derive the next cfgBase as if the patch was applied.
 * (The /api/config response doesn't echo secrets; we also preserve apiKeyConfigured flags.)
 */
export function applyDevConfigPatchToCfgBase(cfgBase: CfgBase, body: any): CfgBase {
  const nextProfiles = Array.isArray(body.inference?.openai_compat?.profiles)
    ? (body.inference.openai_compat.profiles as any[]).map((p) => {
        const prev = cfgBase.openaiCompatProfiles.find((x) => x.id === p.id);
        const apiKeyConfigured = Boolean(String(p.api_key ?? "").trim()) || Boolean(prev?.apiKeyConfigured);

        return {
          id: String(p.id),
          name: String(p.name),
          baseUrl: String(p.base_url),
          modelId: String(p.model),
          authHeader: String(p.auth_header ?? OPENAI_COMPAT_DEFAULT_AUTH_HEADER),
          apiKeyConfigured
        };
      })
    : cfgBase.openaiCompatProfiles;


  const nextAnthropicProfiles = Array.isArray(body.inference?.anthropic?.profiles)
    ? (body.inference.anthropic.profiles as any[]).map((p, idx) => {
        const prev = cfgBase.anthropicProfiles.find((x) => x.id === p.id);
        const apiKeyConfigured = Boolean(String(p.api_key ?? "").trim()) || Boolean(prev?.apiKeyConfigured);

        return {
          id: String(p.id),
          name: String(p.name ?? "").trim() || `Profile ${idx + 1}`,
          baseUrl: String(p.base_url ?? "").trim() || DEFAULT_ANTHROPIC_PROFILE.base_url,
          modelId: String(p.model ?? "").trim() || DEFAULT_ANTHROPIC_PROFILE.model,
          authHeader: String(p.auth_header ?? DEFAULT_ANTHROPIC_PROFILE.auth_header),
          anthropicVersion: String(p.anthropic_version ?? DEFAULT_ANTHROPIC_PROFILE.anthropic_version),
          apiKeyConfigured
        };
      })
    : cfgBase.anthropicProfiles;

  const nextCodexProfiles = Array.isArray((body.inference as any)?.codex_oauth?.profiles)
    ? ((((body.inference as any).codex_oauth.profiles as any[]) ?? [])
        .map((p) => ({
          id: DEFAULT_PROFILE_ID,
          name: String(p.name ?? "").trim() || DEFAULT_PROFILE_NAME,
          model: String(p.model ?? "").trim() || DEFAULT_CODEX_MODEL
        }))
        .slice(0, 1) as CodexOAuthProfile[])
    : cfgBase.codexOAuthProfiles;

  const nextWebProfiles = Array.isArray(body.tools?.web?.profiles)
    ? (body.tools.web.profiles as any[]).map((p, idx) => {
        const prev = cfgBase.webProfiles.find((x) => x.id === p.id);
        const apiKeyConfigured = Boolean(String(p.api_key ?? "").trim()) || Boolean(prev?.apiKeyConfigured);
        const rawProvider = String(p.provider ?? "").trim();
        const provider = isWebProviderId(rawProvider) ? rawProvider : DEFAULT_WEB_PROVIDER;

        return {
          id: String(p.id),
          name: String(p.name ?? "").trim() || `Profile ${idx + 1}`,
          provider,
          projectId: String(p.project_id ?? "").trim(),
          apiKeyConfigured
        };
      })
    : cfgBase.webProfiles;

  let nextWebActiveProfileId =
    typeof body.tools?.web?.active_profile === "string" ? String(body.tools.web.active_profile).trim() : cfgBase.webActiveProfileId;
  if (!nextWebProfiles.some((p) => p.id === nextWebActiveProfileId)) {
    nextWebActiveProfileId = nextWebProfiles[0]?.id ?? DEFAULT_PROFILE_ID;
  }

  const nextEmailEnabled =
    typeof (body as any)?.plugins?.listener?.email?.enabled === "boolean"
      ? Boolean((body as any).plugins.listener.email.enabled)
      : cfgBase.emailListenerEnabled;

  const nextEmailTriagePrompt =
    typeof (body as any)?.plugins?.listener?.email?.triage_prompt === "string"
      ? String((body as any).plugins.listener.email.triage_prompt)
      : cfgBase.emailListenerTriagePrompt;

  const nextEmailAccounts = Array.isArray((body as any)?.plugins?.listener?.email?.accounts)
    ? (((body as any).plugins.listener.email.accounts as any[]) ?? []).map((p) => {
        const id = String(p?.id ?? "").trim();
        const prev = cfgBase.emailListenerAccounts.find((x) => x.id === id);

        const notifyKindRaw = String(p?.notify?.kind ?? "").trim().toLowerCase();
        const notifyKind: "discord" | "telegram" = notifyKindRaw === "telegram" ? "telegram" : "discord";
        const notifyId =
          notifyKind === "telegram" ? String(p?.notify?.chat_id ?? "").trim() : String(p?.notify?.channel_id ?? "").trim();

        const portNum = Number(p?.port);
        const port = Number.isFinite(portNum) ? Math.trunc(portNum) : prev?.port ?? 993;

        const maxBodyNum = Number(p?.max_body_chars);
        const maxBodyChars = Number.isFinite(maxBodyNum) ? Math.max(0, Math.trunc(maxBodyNum)) : prev?.maxBodyChars ?? 12_000;

        const startFrom: "now" = "now";

        const passConfigured = Boolean(String(p?.pass ?? "").trim()) || Boolean(prev?.passConfigured);

        return {
          id,
          host: String(p?.host ?? "").trim(),
          port,
          secure: typeof p?.secure === "boolean" ? Boolean(p.secure) : prev?.secure ?? true,
          user: String(p?.user ?? "").trim(),
          mailbox: String(p?.mailbox ?? prev?.mailbox ?? "INBOX").trim() || "INBOX",
          criterion: String(p?.criterion ?? ""),
          model: typeof p?.model === "string" ? String(p.model) : prev?.model ?? "",
          notifyKind,
          notifyId,
          startFrom,
          maxBodyChars,
          passConfigured
        };
      })
    : cfgBase.emailListenerAccounts;

  return {
    host: body.console?.host ?? cfgBase.host,
    port: body.console?.port ?? cfgBase.port,
    codexHome: typeof body.codex_home === "string" ? body.codex_home : cfgBase.codexHome,
    userPreferredName:
      typeof body.persona?.user_preferred_name === "string" ? String(body.persona.user_preferred_name).trim() : cfgBase.userPreferredName,
    assistantName: typeof body.persona?.assistant_name === "string" ? String(body.persona.assistant_name).trim() : cfgBase.assistantName,
    debugCaptureUpstreamRequests:
      typeof (body as any).debug?.capture_upstream_requests === "boolean"
        ? Boolean((body as any).debug.capture_upstream_requests)
        : cfgBase.debugCaptureUpstreamRequests,
    debugParseAssistantOutput:
      typeof (body as any).debug?.parse_assistant_output === "boolean"
        ? Boolean((body as any).debug.parse_assistant_output)
        : cfgBase.debugParseAssistantOutput,
    systemInstruction:
      typeof (body.inference as any)?.system_instruction === "string" ? (body.inference as any).system_instruction : cfgBase.systemInstruction,
    openaiCompatProfiles: nextProfiles,
    anthropicProfiles: nextAnthropicProfiles,

    codexOAuthProfiles: nextCodexProfiles,

    discordEnabled: body.adapters?.discord?.enabled ?? cfgBase.discordEnabled,
    discordAppId: body.adapters?.discord?.app_id ?? cfgBase.discordAppId,
    discordTokenConfigured: cfgBase.discordTokenConfigured || Boolean(body.adapters?.discord?.bot_token),
    discordGuildWhitelist: body.adapters?.discord?.guild_ids ?? cfgBase.discordGuildWhitelist,
    discordUserWhitelist: body.adapters?.discord?.user_whitelist ?? cfgBase.discordUserWhitelist,
    discordForceGlobalCommands:
      typeof body.adapters?.discord?.force_global_commands === "boolean"
        ? Boolean(body.adapters.discord.force_global_commands)
        : cfgBase.discordForceGlobalCommands,
    discordDefaultStreamMode: normalizeDiscordStreamMode(body.adapters?.discord?.default_stream_mode ?? cfgBase.discordDefaultStreamMode),

    telegramEnabled: body.adapters?.telegram?.enabled ?? cfgBase.telegramEnabled,
    telegramTokenConfigured: cfgBase.telegramTokenConfigured || Boolean(body.adapters?.telegram?.bot_token),
    telegramUserWhitelist: body.adapters?.telegram?.user_whitelist ?? cfgBase.telegramUserWhitelist,
    telegramGroupWhitelist: body.adapters?.telegram?.group_whitelist ?? cfgBase.telegramGroupWhitelist,

    emailListenerEnabled: nextEmailEnabled,
    emailListenerTriagePrompt: nextEmailTriagePrompt,
    emailListenerAccounts: nextEmailAccounts,

    webActiveProfileId: nextWebActiveProfileId,
    webProfiles: nextWebProfiles,

    skillsEnabled: Array.isArray((body as any).skills?.enabled)
      ? ([...((body as any).skills.enabled as string[])].sort((a, b) => a.localeCompare(b)) as string[])
      : cfgBase.skillsEnabled,
    skillsAvailable: cfgBase.skillsAvailable
  };
}

/**
 * Mutate the draft after dev-config save, so the form becomes clean:
 * - clear secret inputs
 * - reflect cfgBase-derived fields
 *
 * Note: this intentionally mirrors the previous behavior (only some fields are updated).
 */
export function draftAfterDevSave(d: SettingsDraft, nextBase: CfgBase, dirtyDevInference: boolean, dirtyDevWeb: boolean): SettingsDraft {
  return {
    ...d,
    userPreferredName: nextBase.userPreferredName,
    assistantName: nextBase.assistantName,
    inferenceProfiles: dirtyDevInference
      ? nextBase.openaiCompatProfiles.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          modelId: p.modelId,
          authHeader: p.authHeader,
          apiKey: ""
        }))
      : d.inferenceProfiles.map((p) => ({ ...p, apiKey: "" })),
    anthropicProfiles: dirtyDevInference
      ? nextBase.anthropicProfiles.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          modelId: p.modelId,
          authHeader: p.authHeader,
          anthropicVersion: p.anthropicVersion,
          apiKey: ""
        }))
      : d.anthropicProfiles.map((p) => ({ ...p, apiKey: "" })),
    codexOAuthProfiles: nextBase.codexOAuthProfiles,
    inferenceSystemInstruction: nextBase.systemInstruction,
    codexHomeOverrideEnabled: Boolean(nextBase.codexHome.trim().length),
    codexHomeOverridePath: nextBase.codexHome,
    adapterDiscordBotToken: "",
    adapterDiscordGuildWhitelist: nextBase.discordGuildWhitelist.join("\n"),
    adapterDiscordUserWhitelist: nextBase.discordUserWhitelist.join("\n"),
    adapterDiscordForceGlobalCommands: nextBase.discordForceGlobalCommands,
    adapterDiscordDefaultStreamMode: nextBase.discordDefaultStreamMode,

    adapterTelegramBotToken: "",
    adapterTelegramUserWhitelist: nextBase.telegramUserWhitelist.join("\n"),
    adapterTelegramGroupWhitelist: nextBase.telegramGroupWhitelist.join("\n"),

    pluginEmailListenerEnabled: nextBase.emailListenerEnabled,
    pluginEmailListenerTriagePrompt: nextBase.emailListenerTriagePrompt,
    pluginEmailListenerAccounts: nextBase.emailListenerAccounts.map((a) => ({
      id: a.id,
      host: a.host,
      port: String(a.port),
      secure: Boolean(a.secure),
      user: a.user,
      pass: "",
      mailbox: a.mailbox,
      criterion: a.criterion,
      model: a.model,
      notifyKind: a.notifyKind,
      notifyId: a.notifyId,
      startFrom: a.startFrom,
      maxBodyChars: String(a.maxBodyChars)
    })),

    webActiveProfileId: dirtyDevWeb ? nextBase.webActiveProfileId : d.webActiveProfileId,
    webProfiles: dirtyDevWeb
      ? nextBase.webProfiles.map((p) => ({
          id: p.id,
          name: p.name,
          provider: p.provider,
          projectId: p.projectId,
          apiKey: ""
        }))
      : d.webProfiles.map((p) => ({ ...p, apiKey: "" })),

    debugCaptureUpstreamRequests: nextBase.debugCaptureUpstreamRequests,

    skillsEnabled: [...nextBase.skillsEnabled]
  };
}
