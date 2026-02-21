import type { CfgBase, CodexOAuthProfile, DevConfig, SettingsDraft } from "./settingsTypes";
import { normalizeDiscordStreamMode, normalizeGuildIds, sameStringArray } from "./settingsUtils";

/**
 * Convert raw dev config (from /api/config) into a normalized, UI-friendly base model.
 * This mirrors the previous in-SettingsView parsing logic.
 */
export function devConfigToCfgBase(config: DevConfig): CfgBase {
  const host = config.console?.host ?? "127.0.0.1";
  const port = config.console?.port ?? 5173;
  const codexHome = String((config as any).codex_home ?? "").trim();
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
    const baseUrl = String(p.base_url ?? "https://api.openai.com/v1").trim() || "https://api.openai.com/v1";
    const modelId = String(p.model ?? "gpt-4o-mini").trim() || "gpt-4o-mini";
    const authHeader = String(p.auth_header ?? "Authorization").trim() || "Authorization";
    const apiKeyConfigured = Boolean(p.api_key_configured);

    profiles.push({ id, name, baseUrl, modelId, authHeader, apiKeyConfigured });
  }

  if (profiles.length === 0) {
    profiles.push({
      id: "default",
      name: "Default",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-4o-mini",
      authHeader: "Authorization",
      apiKeyConfigured: false
    });
  }

  const disc = config.adapters?.discord ?? {};
  const discordEnabled = Boolean((disc as any).enabled ?? false);
  const discordAppId = String((disc as any).app_id ?? "").trim();
  const discordTokenConfigured = Boolean((disc as any).bot_token_configured);
  const discordGuildIds = Array.isArray((disc as any).guild_ids)
    ? (disc as any).guild_ids.map((x: any) => String(x).trim()).filter(Boolean)
    : [];
  const discordDefaultStreamMode = normalizeDiscordStreamMode((disc as any).default_stream_mode);

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
      id: "default",
      name: name || "Default",
      model: model || "gpt-5.2-codex"
    };
    break;
  }

  if (!codexProfile) {
    codexProfile = { id: "default", name: "Default", model: "gpt-5.2-codex" };
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
    debugCaptureUpstreamRequests,
    debugParseAssistantOutput,
    systemInstruction,
    openaiCompatProfiles: profiles,
    codexOAuthProfiles: codexProfiles,

    discordEnabled,
    discordAppId,
    discordTokenConfigured,
    discordGuildIds,
    discordDefaultStreamMode,

    skillsEnabled,
    skillsAvailable
  };
}

export type BuildDevConfigPatchArgs = {
  draft: SettingsDraft;
  cfgBase: CfgBase;

  dirtyDevCodexHome: boolean;
  dirtyDevHostPort: boolean;
  hostPortValid: boolean;
  dirtyDevDebug: boolean;
  dirtyDevInference: boolean;
  inferenceValid: boolean;
  dirtyDevDiscord: boolean;
  discordValid: boolean;
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
    dirtyDevHostPort,
    hostPortValid,
    dirtyDevDebug,
    dirtyDevInference,
    inferenceValid,
    dirtyDevDiscord,
    discordValid,
    dirtyDevSkills
  } = args;

  const body: any = {};

  if (dirtyDevCodexHome) {
    body.codex_home = draft.codexHomeOverrideEnabled ? draft.codexHomeOverridePath.trim() : "";
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
          auth_header: p.authHeader.trim() || "Authorization",
          ...(p.apiKey.trim().length ? { api_key: p.apiKey.trim() } : {})
        }))
      },
      codex_oauth: {
        profiles: draft.codexOAuthProfiles.slice(0, 1).map((p) => ({
          id: "default",
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
    const guildIds = normalizeGuildIds(draft.adapterDiscordGuildIds);
    const guildIdsDirty = !sameStringArray(guildIds, cfgBase.discordGuildIds);
    const streamModeDirty = draft.adapterDiscordDefaultStreamMode !== cfgBase.discordDefaultStreamMode;
    body.adapters = {
      discord: {
        enabled: Boolean(draft.adapterDiscordEnabled),
        // app_id is optional; empty means unchanged.
        ...(appId.length && appId !== cfgBase.discordAppId ? { app_id: appId } : {}),
        // bot_token is optional; empty means unchanged.
        ...(draft.adapterDiscordBotToken.trim().length ? { bot_token: draft.adapterDiscordBotToken.trim() } : {}),
        ...(guildIdsDirty ? { guild_ids: guildIds } : {}),
        ...(streamModeDirty ? { default_stream_mode: draft.adapterDiscordDefaultStreamMode } : {})
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
          authHeader: String(p.auth_header ?? "Authorization"),
          apiKeyConfigured
        };
      })
    : cfgBase.openaiCompatProfiles;

  const nextCodexProfiles = Array.isArray((body.inference as any)?.codex_oauth?.profiles)
    ? ((((body.inference as any).codex_oauth.profiles as any[]) ?? [])
        .map((p) => ({
          id: "default",
          name: String(p.name ?? "").trim() || "Default",
          model: String(p.model ?? "").trim() || "gpt-5.2-codex"
        }))
        .slice(0, 1) as CodexOAuthProfile[])
    : cfgBase.codexOAuthProfiles;

  return {
    host: body.console?.host ?? cfgBase.host,
    port: body.console?.port ?? cfgBase.port,
    codexHome: typeof body.codex_home === "string" ? body.codex_home : cfgBase.codexHome,
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

    codexOAuthProfiles: nextCodexProfiles,

    discordEnabled: body.adapters?.discord?.enabled ?? cfgBase.discordEnabled,
    discordAppId: body.adapters?.discord?.app_id ?? cfgBase.discordAppId,
    discordTokenConfigured: cfgBase.discordTokenConfigured || Boolean(body.adapters?.discord?.bot_token),
    discordGuildIds: body.adapters?.discord?.guild_ids ?? cfgBase.discordGuildIds,
    discordDefaultStreamMode: normalizeDiscordStreamMode(body.adapters?.discord?.default_stream_mode ?? cfgBase.discordDefaultStreamMode),

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
export function draftAfterDevSave(d: SettingsDraft, nextBase: CfgBase, dirtyDevInference: boolean): SettingsDraft {
  return {
    ...d,
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
    codexOAuthProfiles: nextBase.codexOAuthProfiles,
    inferenceSystemInstruction: nextBase.systemInstruction,
    codexHomeOverrideEnabled: Boolean(nextBase.codexHome.trim().length),
    codexHomeOverridePath: nextBase.codexHome,
    adapterDiscordBotToken: "",
    adapterDiscordGuildIds: nextBase.discordGuildIds.join("\n"),
    adapterDiscordDefaultStreamMode: nextBase.discordDefaultStreamMode,

    debugCaptureUpstreamRequests: nextBase.debugCaptureUpstreamRequests,

    skillsEnabled: [...nextBase.skillsEnabled]
  };
}
