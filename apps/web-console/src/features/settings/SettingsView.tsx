import React from "react";
import { runtime } from "../../core/runtime";
import type { TransportId } from "../../core/transport/TransportRegistry";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { useStagedDraft } from "../common/useStagedDraft";
import { Collapsible } from "../common/Collapsible";

type CodexOAuthProfile = {
  id: string;
  name: string;
  model: string;
};

type CodexOAuthStatus = {
  requires_openai_auth: boolean;
  account: null | {
    type: string;
    email?: string;
    planType?: string;
  };
  models: string[] | null;
};

type SettingsDraft = {
  textureDisabled: boolean;
  sessionSyncEnabled: boolean;
  displayPlainOutput: boolean;
  debugCaptureUpstreamRequests: boolean;
  transport: TransportId;
  model: string;
  contextTokenLimit: string;
  contextLimitEnabled: boolean;

  // Dev-only (written to eclia.config.local.toml via the local backend).
  consoleHost: string;
  consolePort: string; // keep as string for input UX

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

type DevConfig = {
  codex_home?: string;
  console: { host: string; port: number };
  api?: { port: number };
  debug?: { capture_upstream_requests?: boolean };
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
};

function normalizeDiscordStreamMode(v: unknown): "full" | "final" {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "full" ? "full" : "final";
}

type ConfigResponse =
  | { ok: true; config: DevConfig; restartRequired?: boolean; warning?: string }
  | { ok: false; error: string; hint?: string };

function isValidPort(s: string): boolean {
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  const i = Math.trunc(n);
  return i >= 1 && i <= 65535;
}

function portNumber(s: string): number | null {
  if (!isValidPort(s)) return null;
  return Math.trunc(Number(s));
}

function parseContextLimit(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 20000;
  return Math.max(256, Math.min(1_000_000, Math.trunc(n)));
}

function normalizeGuildIds(input: string): string[] {
  const raw = String(input ?? "")
    .split(/[\n\r,\t\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function openaiProfileRoute(profileId: string): string {
  return `openai-compatible:${profileId}`;
}

function codexProfileRoute(profileId: string): string {
  return `codex-oauth:${profileId}`;
}

function newLocalId(fallbackPrefix: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
  return uuid ?? `${fallbackPrefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

function normalizeActiveModel(current: string, profiles: Array<{ id: string }> | null | undefined): string {
  const k = String(current ?? "").trim();

  // Codex routes are managed entirely on the frontend for now. Preserve them.
  if (/^codex-oauth(?::|$)/.test(k)) return k;

  if (!profiles || profiles.length === 0) return k;

  const first = openaiProfileRoute(profiles[0].id);

  const m = k.match(/^openai-compatible:(.+)$/);
  if (m) {
    const id = String(m[1] ?? "").trim();
    if (profiles.some((p) => p.id === id)) return k;
    return first;
  }

  // Legacy route keys and any other values map to the default profile.
  return first;
}

function sameOpenAICompatProfiles(
  draft: SettingsDraft["inferenceProfiles"],
  base: Array<{ id: string; name: string; baseUrl: string; modelId: string; authHeader: string }>
): boolean {
  if (draft.length !== base.length) return false;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i];
    const b = base[i];
    if (a.id !== b.id) return false;
    if (a.name.trim() !== b.name) return false;
    if (a.baseUrl.trim() !== b.baseUrl) return false;
    if (a.modelId.trim() !== b.modelId) return false;
    if (a.authHeader.trim() !== b.authHeader) return false;
  }
  return true;
}

function sameCodexOAuthProfiles(draft: SettingsDraft["codexOAuthProfiles"], base: CodexOAuthProfile[]): boolean {
  if (draft.length !== base.length) return false;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i];
    const b = base[i];
    if (a.id !== b.id) return false;
    if (a.name.trim() !== b.name) return false;
    if (a.model.trim() !== b.model) return false;
  }
  return true;
}

/**
 * Settings uses an explicit "Save" to commit changes.
 * While dirty, leaving the page is blocked to avoid accidental loss.
 */
export function SettingsView({ onBack }: { onBack: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const transports = runtime.transports.list();

  // Dev config (TOML) is owned by the local backend (dev only).
  const [cfgLoading, setCfgLoading] = React.useState(false);
  const [cfgError, setCfgError] = React.useState<string | null>(null);
  const [cfgSaved, setCfgSaved] = React.useState<string | null>(null);

  const [cfgBase, setCfgBase] = React.useState<{
    host: string;
    port: number;
    codexHome: string;
    debugCaptureUpstreamRequests: boolean;
    systemInstruction: string;
    openaiCompatProfiles: Array<{
      id: string;
      name: string;
      baseUrl: string;
      modelId: string;
      authHeader: string;
      apiKeyConfigured: boolean;
    }>;

    codexOAuthProfiles: CodexOAuthProfile[];

    discordEnabled: boolean;
    discordAppId: string;
    discordTokenConfigured: boolean;
    discordGuildIds: string[];
    discordDefaultStreamMode: "full" | "final";

    skillsEnabled: string[];
    skillsAvailable: Array<{ name: string; summary: string }>;
  } | null>(null);

  // Load TOML config (best-effort).
  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setCfgLoading(true);
      setCfgError(null);
      setCfgSaved(null);

      try {
        const r = await fetch("/api/config", { method: "GET" });
        const j = (await r.json()) as ConfigResponse;
        if (cancelled) return;
        if (!j.ok) throw new Error(j.hint ?? j.error);

        const host = j.config.console.host ?? "127.0.0.1";
        const port = j.config.console.port ?? 5173;
        const codexHome = String((j.config as any).codex_home ?? "").trim();
        const debugCaptureUpstreamRequests = Boolean((j.config as any)?.debug?.capture_upstream_requests ?? false);
        const systemInstruction = String((j.config.inference as any)?.system_instruction ?? "");

        const inf = j.config.inference?.openai_compat ?? {};
        const rawProfiles = Array.isArray((inf as any).profiles) ? ((inf as any).profiles as any[]) : [];
        const profiles: Array<{
          id: string;
          name: string;
          baseUrl: string;
          modelId: string;
          authHeader: string;
          apiKeyConfigured: boolean;
        }> = [];
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

        const disc = j.config.adapters?.discord ?? {};
        const discordEnabled = Boolean((disc as any).enabled ?? false);
        const discordAppId = String((disc as any).app_id ?? "").trim();
        const discordTokenConfigured = Boolean((disc as any).bot_token_configured);
        const discordGuildIds = Array.isArray((disc as any).guild_ids)
          ? (disc as any).guild_ids.map((x: any) => String(x).trim()).filter(Boolean)
          : [];
        const discordDefaultStreamMode = normalizeDiscordStreamMode((disc as any).default_stream_mode);

        const codex = (j.config.inference as any)?.codex_oauth ?? {};
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

        const skillsEnabled = Array.isArray((j.config as any)?.skills?.enabled)
          ? ((j.config as any).skills.enabled as any[]).map((x: any) => String(x).trim()).filter(Boolean)
          : [];
        skillsEnabled.sort((a, b) => a.localeCompare(b));

        const rawAvail = Array.isArray((j.config as any)?.skills?.available) ? ((j.config as any).skills.available as any[]) : [];
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

        setCfgBase({
          host,
          port,
          codexHome,
          debugCaptureUpstreamRequests,
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
        });
      } catch {
        if (cancelled) return;
        // Dev config editing is optional; do not break Settings if the backend isn't running.
        setCfgError("Config service unavailable. Start the backend (pnpm dev:all) to edit TOML config.");
        setCfgBase(null);
      } finally {
        if (cancelled) return;
        setCfgLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const getCleanDraft = React.useCallback(
    (prev: SettingsDraft | undefined): SettingsDraft => {
      return {
        textureDisabled: state.settings.textureDisabled,
        sessionSyncEnabled: state.settings.sessionSyncEnabled,
        displayPlainOutput: Boolean(state.settings.displayPlainOutput ?? false),
        debugCaptureUpstreamRequests: cfgBase ? cfgBase.debugCaptureUpstreamRequests : prev?.debugCaptureUpstreamRequests ?? false,
        transport: state.transport,
        model: cfgBase ? normalizeActiveModel(state.model, cfgBase.openaiCompatProfiles) : state.model,
        contextTokenLimit: String(state.settings.contextTokenLimit ?? 20000),
        contextLimitEnabled: Boolean(state.settings.contextLimitEnabled ?? true),

        consoleHost: cfgBase?.host ?? prev?.consoleHost ?? "",
        consolePort: cfgBase ? String(cfgBase.port) : prev?.consolePort ?? "",

        inferenceProfiles: cfgBase
          ? cfgBase.openaiCompatProfiles.map((p) => ({
              id: p.id,
              name: p.name,
              baseUrl: p.baseUrl,
              modelId: p.modelId,
              authHeader: p.authHeader,
              apiKey: ""
            }))
          : prev?.inferenceProfiles ?? [],

        codexOAuthProfiles: cfgBase
          ? cfgBase.codexOAuthProfiles.map((p) => ({ ...p })).slice(0, 1)
          : prev?.codexOAuthProfiles?.length
            ? [{ ...prev.codexOAuthProfiles[0], id: "default" }]
            : [{ id: "default", name: "Default", model: "gpt-5.2-codex" }],

        inferenceSystemInstruction: cfgBase ? cfgBase.systemInstruction : prev?.inferenceSystemInstruction ?? "",

        codexHomeOverrideEnabled: cfgBase ? Boolean(cfgBase.codexHome.trim().length) : prev?.codexHomeOverrideEnabled ?? false,
        codexHomeOverridePath: cfgBase ? cfgBase.codexHome : prev?.codexHomeOverridePath ?? "",

        adapterDiscordEnabled: cfgBase?.discordEnabled ?? prev?.adapterDiscordEnabled ?? false,
        adapterDiscordAppId: cfgBase?.discordAppId ?? prev?.adapterDiscordAppId ?? "",
        adapterDiscordBotToken: "",
        adapterDiscordGuildIds: cfgBase ? cfgBase.discordGuildIds.join("\n") : prev?.adapterDiscordGuildIds ?? "",
        adapterDiscordDefaultStreamMode: cfgBase?.discordDefaultStreamMode ?? prev?.adapterDiscordDefaultStreamMode ?? "final",

        skillsEnabled: cfgBase ? [...cfgBase.skillsEnabled] : prev?.skillsEnabled ?? []
      };
    },
    [
      state.settings.textureDisabled,
      state.settings.sessionSyncEnabled,
      state.settings.displayPlainOutput,
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      state.transport,
      state.model,
      cfgBase
    ]
  );

  const isDirtyDraft = React.useCallback(
    (d: SettingsDraft): boolean => {
      const effectiveStateModel = cfgBase ? normalizeActiveModel(state.model, cfgBase.openaiCompatProfiles) : state.model;

      const dirtyUi =
        d.textureDisabled !== state.settings.textureDisabled ||
        d.sessionSyncEnabled !== state.settings.sessionSyncEnabled ||
        d.displayPlainOutput !== Boolean(state.settings.displayPlainOutput ?? false) ||
        d.transport !== state.transport ||
        d.model !== effectiveStateModel ||
        d.contextLimitEnabled !== state.settings.contextLimitEnabled ||
        parseContextLimit(d.contextTokenLimit) !== state.settings.contextTokenLimit;

      const dirtyDevHostPort = cfgBase
        ? d.consoleHost.trim() !== cfgBase.host || portNumber(d.consolePort) !== cfgBase.port
        : false;

      const dirtyDevDebug = cfgBase ? d.debugCaptureUpstreamRequests !== cfgBase.debugCaptureUpstreamRequests : false;

      const dirtyDevInference = cfgBase
        ? !sameOpenAICompatProfiles(d.inferenceProfiles, cfgBase.openaiCompatProfiles) ||
          !sameCodexOAuthProfiles(d.codexOAuthProfiles, cfgBase.codexOAuthProfiles) ||
          d.inferenceProfiles.some((p) => p.apiKey.trim().length > 0) ||
          d.inferenceSystemInstruction.trim() !== (cfgBase.systemInstruction ?? "").trim()
        : false;

      const dirtyDevCodexHome = cfgBase
        ? (d.codexHomeOverrideEnabled ? d.codexHomeOverridePath.trim() : "") !== cfgBase.codexHome.trim()
        : false;

      const dirtyDevDiscord = cfgBase
        ? d.adapterDiscordEnabled !== cfgBase.discordEnabled ||
          d.adapterDiscordAppId.trim() !== cfgBase.discordAppId ||
          d.adapterDiscordBotToken.trim().length > 0 ||
          !sameStringArray(normalizeGuildIds(d.adapterDiscordGuildIds), cfgBase.discordGuildIds) ||
          d.adapterDiscordDefaultStreamMode !== cfgBase.discordDefaultStreamMode
        : false;

      const dirtyDevSkills = cfgBase ? !sameStringArray(d.skillsEnabled, cfgBase.skillsEnabled) : false;

      return dirtyUi || dirtyDevHostPort || dirtyDevDebug || dirtyDevInference || dirtyDevCodexHome || dirtyDevDiscord || dirtyDevSkills;
    },
    [
      state.settings.textureDisabled,
      state.settings.sessionSyncEnabled,
      state.settings.displayPlainOutput,
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      state.transport,
      state.model,
      cfgBase
    ]
  );

  const { draft, setDraft, dirty, discard: discardDraft } = useStagedDraft<SettingsDraft>({
    getCleanDraft,
    isDirty: isDirtyDraft,
    syncDeps: [
      state.settings.textureDisabled,
      state.settings.sessionSyncEnabled,
      state.settings.displayPlainOutput,
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      state.transport,
      state.model,
      cfgBase
    ]
  });

  const dirtyDevHostPort = cfgBase
    ? draft.consoleHost.trim() !== cfgBase.host || portNumber(draft.consolePort) !== cfgBase.port
    : false;

  const dirtyDevDebug = cfgBase ? draft.debugCaptureUpstreamRequests !== cfgBase.debugCaptureUpstreamRequests : false;

  const dirtyDevInference = cfgBase
    ? !sameOpenAICompatProfiles(draft.inferenceProfiles, cfgBase.openaiCompatProfiles) ||
      !sameCodexOAuthProfiles(draft.codexOAuthProfiles, cfgBase.codexOAuthProfiles) ||
      draft.inferenceProfiles.some((p) => p.apiKey.trim().length > 0) ||
      draft.inferenceSystemInstruction.trim() !== (cfgBase.systemInstruction ?? "").trim()
    : false;

  const dirtyDevCodexHome = cfgBase
    ? (draft.codexHomeOverrideEnabled ? draft.codexHomeOverridePath.trim() : "") !== cfgBase.codexHome.trim()
    : false;

  const dirtyDevDiscord = cfgBase
    ? draft.adapterDiscordEnabled !== cfgBase.discordEnabled ||
      draft.adapterDiscordAppId.trim() !== cfgBase.discordAppId ||
      draft.adapterDiscordBotToken.trim().length > 0 ||
      !sameStringArray(normalizeGuildIds(draft.adapterDiscordGuildIds), cfgBase.discordGuildIds) ||
      draft.adapterDiscordDefaultStreamMode !== cfgBase.discordDefaultStreamMode
    : false;

  const dirtyDevSkills = cfgBase ? !sameStringArray(draft.skillsEnabled, cfgBase.skillsEnabled) : false;

  const dirtyDev = dirtyDevHostPort || dirtyDevDebug || dirtyDevInference || dirtyDevCodexHome || dirtyDevDiscord || dirtyDevSkills;

  const [saving, setSaving] = React.useState(false);

  const hostPortValid = draft.consoleHost.trim().length > 0 && isValidPort(draft.consolePort);
  const codexHomeValid = !draft.codexHomeOverrideEnabled || draft.codexHomeOverridePath.trim().length > 0;
  const openaiValid =
    draft.inferenceProfiles.length > 0 &&
    draft.inferenceProfiles.every((p) => p.name.trim().length > 0 && p.baseUrl.trim().length > 0 && p.modelId.trim().length > 0);
  const codexValid = draft.codexOAuthProfiles.every((p) => p.id.trim().length > 0 && p.name.trim().length > 0 && p.model.trim().length > 0);
  const inferenceValid = openaiValid && codexValid;

  const discordTokenOk = Boolean(cfgBase?.discordTokenConfigured) || draft.adapterDiscordBotToken.trim().length > 0;
  const discordAppIdOk = Boolean((cfgBase?.discordAppId ?? "").trim().length) || draft.adapterDiscordAppId.trim().length > 0;
  const discordValid = !draft.adapterDiscordEnabled || (discordTokenOk && discordAppIdOk);

  const canSave =
    dirty &&
    !saving &&
    (!dirtyDev ||
      (!!cfgBase &&
        !cfgLoading &&
        (!dirtyDevHostPort || hostPortValid) &&
        (!dirtyDevInference || inferenceValid) &&
        (!dirtyDevCodexHome || codexHomeValid) &&
        (!dirtyDevDiscord || discordValid)));

  const discard = () => {
    discardDraft();
    setCfgError(null);
    setCfgSaved(null);
  };

  const save = async () => {
    if (!canSave) return;

    setSaving(true);
    setCfgError(null);
    setCfgSaved(null);

    try {
      let nextCfgBase = cfgBase;

      // 1) Save TOML startup config first (most likely to fail).
      if (dirtyDev) {
        if (!cfgBase) throw new Error("Config service unavailable.");

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
            capture_upstream_requests: Boolean(draft.debugCaptureUpstreamRequests)
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

        setCfgLoading(true);
        try {
          const r = await fetch("/api/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });

          const j = (await r.json()) as ConfigResponse;
          if (!j.ok) throw new Error(j.hint ?? j.error);

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
            ? (((body.inference as any).codex_oauth.profiles as any[]) ?? [])
                .map((p) => ({
                  id: "default",
                  name: String(p.name ?? "").trim() || "Default",
                  model: String(p.model ?? "").trim() || "gpt-5.2-codex"
                }))
                .slice(0, 1)
            : cfgBase.codexOAuthProfiles;

          const nextBase = {
            host: body.console?.host ?? cfgBase.host,
            port: body.console?.port ?? cfgBase.port,
            codexHome: typeof body.codex_home === "string" ? body.codex_home : cfgBase.codexHome,
            debugCaptureUpstreamRequests:
              typeof (body as any).debug?.capture_upstream_requests === "boolean"
                ? Boolean((body as any).debug.capture_upstream_requests)
                : cfgBase.debugCaptureUpstreamRequests,
            systemInstruction: typeof (body.inference as any)?.system_instruction === "string" ? (body.inference as any).system_instruction : cfgBase.systemInstruction,
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

          setCfgBase(nextBase);
          nextCfgBase = nextBase;

          // Clear secret inputs after a successful save so the form becomes clean.
          setDraft((d) => ({
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
          }));

          setCfgSaved(
            dirtyDevHostPort
              ? "Saved to eclia.config.local.toml. Restart required to apply host/port changes."
              : dirtyDevDiscord
                ? "Saved to eclia.config.local.toml. Restart required to apply adapter changes."
                : dirtyDevCodexHome
                  ? "Saved to eclia.config.local.toml. Restart required to apply Codex home changes."
                : "Saved to eclia.config.local.toml."
          );
        } finally {
          setCfgLoading(false);
        }
      }

      // 2) Commit UI/runtime changes.
      if (draft.textureDisabled !== state.settings.textureDisabled) {
        dispatch({ type: "settings/textureDisabled", enabled: draft.textureDisabled });
      }

      if (draft.sessionSyncEnabled !== state.settings.sessionSyncEnabled) {
        dispatch({ type: "settings/sessionSyncEnabled", enabled: draft.sessionSyncEnabled });
      }

      if (draft.displayPlainOutput !== Boolean(state.settings.displayPlainOutput ?? false)) {
        dispatch({ type: "settings/displayPlainOutput", enabled: draft.displayPlainOutput });
      }
      if (draft.transport !== state.transport) {
        dispatch({ type: "transport/set", transport: draft.transport });
      }
      {
        const effectiveModelForDispatch = nextCfgBase
          ? normalizeActiveModel(state.model, nextCfgBase.openaiCompatProfiles)
          : state.model;

        if (draft.model !== effectiveModelForDispatch) {
          dispatch({ type: "model/set", model: draft.model });
        }
      }

      if (draft.contextLimitEnabled !== state.settings.contextLimitEnabled) {
        dispatch({ type: "settings/contextLimitEnabled", enabled: draft.contextLimitEnabled });
      }

      const nextLimit = parseContextLimit(draft.contextTokenLimit);
      if (nextLimit !== state.settings.contextTokenLimit) {
        dispatch({ type: "settings/contextTokenLimit", value: nextLimit });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save config.";
      setCfgError(msg);
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    if (dirty || saving) return;
    onBack();
  };

  const webgl2Text =
    state.gpu.available === null ? "WebGL2: checking…" : state.gpu.available ? "WebGL2: available" : "WebGL2: unavailable";

  type SettingsSectionId = "general" | "appearance" | "inference" | "adapters" | "skills";

  const sections: Array<{ id: SettingsSectionId; label: string }> = [
    { id: "general", label: "General" },
    { id: "appearance", label: "Appearance" },
    { id: "inference", label: "Inference" },
    { id: "adapters", label: "Adapters" },
    { id: "skills", label: "Skills" }
  ];

  const [activeSection, setActiveSection] = React.useState<SettingsSectionId>("general");

  const [expandedOpenAICompatProfileId, setExpandedOpenAICompatProfileId] = React.useState<string | null>(null);

  const codexProfiles = draft.codexOAuthProfiles;
  const [codexLoginBusyProfileId, setCodexLoginBusyProfileId] = React.useState<string | null>(null);
  const [codexLoginMsg, setCodexLoginMsg] = React.useState<string | null>(null);

  const [codexStatusLoading, setCodexStatusLoading] = React.useState(false);
  const [codexStatus, setCodexStatus] = React.useState<CodexOAuthStatus | null>(null);
  const [codexStatusError, setCodexStatusError] = React.useState<string | null>(null);
  const [codexStatusCheckedAt, setCodexStatusCheckedAt] = React.useState<number | null>(null);

  const [codexHomePickBusy, setCodexHomePickBusy] = React.useState(false);
  const [codexHomePickMsg, setCodexHomePickMsg] = React.useState<string | null>(null);

  const pickCodexHome = React.useCallback(async () => {
    setCodexHomePickMsg(null);
    setCodexHomePickBusy(true);
    try {
      const r = await fetch("/api/native/pick-folder", { method: "POST" });
      let j: any = null;
      try {
        j = await r.json();
      } catch {
        j = null;
      }

      if (!r.ok) {
        const hint = typeof j?.hint === "string" ? j.hint : null;
        const err = typeof j?.error === "string" ? j.error : typeof j?.message === "string" ? j.message : null;
        throw new Error(hint ?? err ?? `Failed to open folder picker (HTTP ${r.status}).`);
      }

      if (j?.ok !== true) {
        // Silent no-op on user cancel.
        const e = typeof j?.error === "string" ? j.error : "";
        if (e === "cancelled") return;
        const hint = typeof j?.hint === "string" ? j.hint : null;
        throw new Error(hint ?? (e || "Folder picker failed."));
      }

      const p = String(j?.path ?? "").trim();
      if (!p) throw new Error("No folder selected.");

      setDraft((d) => ({
        ...d,
        codexHomeOverrideEnabled: true,
        codexHomeOverridePath: p
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to select folder.";
      setCodexHomePickMsg(msg);
    } finally {
      setCodexHomePickBusy(false);
    }
  }, [setDraft]);

  const refreshCodexStatus = React.useCallback(async () => {
    setCodexStatusError(null);
    setCodexStatusLoading(true);
    try {
      const r = await fetch("/api/codex/oauth/status", { method: "GET" });
      let j: any = null;
      try {
        j = await r.json();
      } catch {
        j = null;
      }

      if (!r.ok) {
        if (r.status === 404) throw new Error("Codex status backend not implemented.");
        const hint = typeof j?.hint === "string" ? j.hint : null;
        const err = typeof j?.error === "string" ? j.error : typeof j?.message === "string" ? j.message : null;
        throw new Error(hint ?? err ?? `Failed to check status (HTTP ${r.status}).`);
      }

      if (j?.ok !== true) {
        const hint = typeof j?.hint === "string" ? j.hint : null;
        const err = typeof j?.error === "string" ? j.error : typeof j?.message === "string" ? j.message : null;
        throw new Error(hint ?? err ?? "Failed to check status.");
      }

      const st: CodexOAuthStatus = {
        requires_openai_auth: j?.requires_openai_auth === true,
        account: j?.account && typeof j.account === "object" ? j.account : null,
        models: Array.isArray(j?.models) ? (j.models as string[]) : null
      };

      setCodexStatus(st);
      setCodexStatusCheckedAt(Date.now());
    } catch (e) {
      setCodexStatus(null);
      const msg = e instanceof Error ? e.message : "Failed to check Codex status.";
      setCodexStatusError(msg);
    } finally {
      setCodexStatusLoading(false);
    }
  }, []);

  // Best-effort: check status once when entering the inference section.
  React.useEffect(() => {
    if (activeSection !== "inference") return;
    if (!cfgBase) return;
    if (!codexProfiles.length) return;
    if (codexStatusLoading) return;
    if (codexStatusCheckedAt !== null) return;
    void refreshCodexStatus();
  }, [activeSection, cfgBase, codexProfiles.length, codexStatusLoading, codexStatusCheckedAt, refreshCodexStatus]);

  React.useEffect(() => {
    // Avoid "correcting" the provider selection before the config baseline
    // is hydrated. Otherwise, we can accidentally mark the page dirty and block
    // OpenAI profile hydration (you'd need to hit Discard to recover).
    if (!cfgBase && !cfgError) return;

    const k = String(draft.model ?? "").trim();
    const isCodex = /^codex-oauth(?::|$)/.test(k);
    const isOpenAI = /^openai-compatible(?::|$)/.test(k) || k === "openai-compatible" || !k;

    if (isCodex) {
      const codexOk = codexProfiles.some((p) => codexProfileRoute(p.id) === k);
      if (codexOk) return;
      const next = codexProfiles.length
        ? codexProfileRoute(codexProfiles[0].id)
        : draft.inferenceProfiles.length
          ? openaiProfileRoute(draft.inferenceProfiles[0].id)
          : k;
      if (k !== next) setDraft((d) => ({ ...d, model: next }));
      return;
    }

    if (isOpenAI) {
      const openaiOk = draft.inferenceProfiles.some((p) => openaiProfileRoute(p.id) === k);
      if (openaiOk) return;

      if (draft.inferenceProfiles.length) {
        const next = openaiProfileRoute(draft.inferenceProfiles[0].id);
        if (k !== next) setDraft((d) => ({ ...d, model: next }));
      } else if (!cfgBase && codexProfiles.length) {
        // Config service unavailable: fall back to Codex so the dropdown isn't blank.
        const next = codexProfileRoute(codexProfiles[0].id);
        if (k !== next) setDraft((d) => ({ ...d, model: next }));
      }
    }
  }, [cfgBase, cfgError, draft.inferenceProfiles, draft.model, codexProfiles, setDraft]);

  const patchOpenAICompatProfile = React.useCallback(
    (profileId: string, patch: Partial<SettingsDraft["inferenceProfiles"][number]>) => {
      setDraft((d) => ({
        ...d,
        inferenceProfiles: d.inferenceProfiles.map((p) => (p.id === profileId ? { ...p, ...patch } : p))
      }));
    },
    [setDraft]
  );

  const newOpenAICompatProfile = React.useCallback(() => {
    const id = newLocalId("p");

    setDraft((d) => {
      const base = d.inferenceProfiles[0];
      const next = {
        id,
        name: "New profile",
        baseUrl: base?.baseUrl ?? "https://api.openai.com/v1",
        modelId: base?.modelId ?? "gpt-4o-mini",
        authHeader: base?.authHeader ?? "Authorization",
        apiKey: ""
      };
      return { ...d, inferenceProfiles: [...d.inferenceProfiles, next] };
    });

    setExpandedOpenAICompatProfileId(id);
  }, [setDraft]);

  const deleteOpenAICompatProfile = React.useCallback(
    (profileId: string) => {
      setDraft((d) => {
        if (d.inferenceProfiles.length <= 1) return d;
        return {
          ...d,
          inferenceProfiles: d.inferenceProfiles.filter((p) => p.id !== profileId)
        };
      });

      setExpandedOpenAICompatProfileId((prev) => (prev === profileId ? null : prev));
    },
    [setDraft]
  );

  const patchCodexProfile = React.useCallback(
    (profileId: string, patch: Partial<CodexOAuthProfile>) => {
      setDraft((d) => ({
        ...d,
        codexOAuthProfiles: d.codexOAuthProfiles.map((p) => (p.id === profileId ? { ...p, ...patch } : p))
      }));
    },
    [setDraft]
  );

  const startCodexBrowserLogin = React.useCallback(async (profileId: string) => {
    setCodexLoginMsg(null);
    setCodexLoginBusyProfileId(profileId);

    // Open a blank popup synchronously to avoid popup blockers.
    // NOTE: We intentionally do NOT pass noopener here because some browsers will
    // still open the tab but return `null`, which prevents us from closing it on error.
    // We manually null out opener after opening as a best-effort safety measure.
    const popup = window.open("about:blank", "_blank");
    try {
      if (popup) popup.opener = null;
    } catch {
      // ignore
    }
    try {
      if (popup && popup.document) {
        popup.document.title = "ECLIA – Codex login";
        popup.document.body.innerHTML =
          '<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; padding: 24px;">Starting Codex browser login…</div>';
      }
    } catch {
      // ignore
    }

    try {
      const profile = codexProfiles.find((p) => p.id === profileId);
      if (!profile) throw new Error("Missing Codex profile.");

      const r = await fetch("/api/codex/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { id: profile.id, name: profile.name, model: profile.model } })
      });

      let j: any = null;
      try {
        j = await r.json();
      } catch {
        j = null;
      }

      if (!r.ok) {
        if (r.status === 404) {
          throw new Error("Codex login backend not implemented.");
        }
        const hint = typeof j?.hint === "string" ? j.hint : null;
        const err = typeof j?.error === "string" ? j.error : typeof j?.message === "string" ? j.message : null;
        throw new Error(hint ?? err ?? `Failed to start login (HTTP ${r.status}).`);
      }

      const url = typeof j?.url === "string" ? j.url.trim() : "";
      if (url) {
        if (popup && !popup.closed) {
          popup.location.href = url;
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        setCodexLoginMsg("Browser login started.");
      } else {
        // If we don't have an auth URL, the login flow can't proceed.
        setCodexLoginMsg("No authorization URL returned from server.");

        // Some browsers refuse window.close() outside a direct user gesture.
        // Prefer showing an error message instead of leaving a blank tab.
        if (popup && !popup.closed) {
          try {
            popup.document.title = "ECLIA – Codex login failed";
            popup.document.body.innerHTML =
              '<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; padding: 24px;">' +
              '<h2 style="margin: 0 0 10px 0;">Codex login failed</h2>' +
              '<p style="margin: 0 0 12px 0;">The server did not return an authorization URL.</p>' +
              '<p style="margin: 0; opacity: 0.8;">Close this window and return to Settings to see the error details.</p>' +
              "</div>";
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start browser login.";
      setCodexLoginMsg(msg);

      // Some browsers refuse window.close() outside a direct user gesture.
      // Prefer showing an error message instead of leaving a blank tab.
      if (popup && !popup.closed) {
        try {
          popup.document.title = "ECLIA – Codex login failed";
          popup.document.body.innerHTML =
            '<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; padding: 24px;">' +
            '<h2 style="margin: 0 0 10px 0;">Codex login failed</h2>' +
            '<pre id="eclia-codex-login-error" style="white-space: pre-wrap; word-break: break-word; background: #111; color: #eee; padding: 12px; border-radius: 8px;">' +
            "</pre>" +
            '<p style="margin: 12px 0 0 0; opacity: 0.8;">Return to Settings to fix the issue and retry. You can also close this window.</p>' +
            "</div>";
          const el = popup.document.getElementById("eclia-codex-login-error");
          if (el) (el as any).textContent = msg;
        } catch {
          // ignore
        }
      }
    } finally {
      setCodexLoginBusyProfileId(null);
    }
  }, [codexProfiles]);

  const clearCodexOAuthConfig = React.useCallback(async () => {
    setCodexLoginMsg(null);
    setCodexLoginBusyProfileId("default");
    try {
      const r = await fetch("/api/codex/oauth/clear", { method: "POST" });
      let j: any = null;
      try {
        j = await r.json();
      } catch {
        j = null;
      }

      if (!r.ok) {
        if (r.status === 404) throw new Error("Codex clear backend not implemented.");
        const hint = typeof j?.hint === "string" ? j.hint : null;
        const err = typeof j?.error === "string" ? j.error : typeof j?.message === "string" ? j.message : null;
        throw new Error(hint ?? err ?? `Failed to clear config (HTTP ${r.status}).`);
      }

      if (j?.ok !== true) {
        const hint = typeof j?.hint === "string" ? j.hint : null;
        const err = typeof j?.error === "string" ? j.error : typeof j?.message === "string" ? j.message : null;
        throw new Error(hint ?? err ?? "Failed to clear config.");
      }

      const reset: CodexOAuthProfile = { id: "default", name: "Default", model: "gpt-5.2-codex" };
      setDraft((d) => ({ ...d, codexOAuthProfiles: [reset] }));
      setCfgBase((b) => (b ? { ...b, codexOAuthProfiles: [reset] } : b));

      // Force a re-check so the UI reflects the new state quickly.
      setCodexStatus(null);
      setCodexStatusCheckedAt(null);
      void refreshCodexStatus();

      setCodexLoginMsg("Signed out and reset Codex OAuth configuration.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to clear Codex OAuth configuration.";
      setCodexLoginMsg(msg);
    } finally {
      setCodexLoginBusyProfileId(null);
    }
  }, [refreshCodexStatus]);

  return (
    <div className="settingsview motion-page">
      <div className="settings-head">
        <button className="btn icon" onClick={back} aria-label="Back" disabled={dirty || saving}>
          ←
        </button>

        <div className="settings-head-title">
          <div className="brand brand-md" data-text="ECLIA">
            ECLIA
          </div>
          <div className="settings-title">Settings</div>
        </div>

        <div className="settings-head-actions">
          {dirty && (
            <div className="saveIndicator" role="status" aria-live="polite">
              <span className="saveDot" aria-hidden="true" />
              Unsaved changes
            </div>
          )}

          <button className="btn subtle" onClick={discard} disabled={!dirty || saving} aria-label="Discard changes">
            Discard
          </button>

          <button className="btn subtle" onClick={save} disabled={!canSave} aria-label="Save settings">
            {saving ? "Saving…" : "Save"}
          </button>

          <ThemeModeSwitch compact />
        </div>
      </div>

      <div className="settings-body">
        <aside className="settings-sidebar" aria-label="Settings navigation">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className="settings-nav-btn"
                data-active={activeSection === s.id ? "true" : "false"}
                aria-current={activeSection === s.id ? "page" : undefined}
                onClick={() => setActiveSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-content">
          <div key={activeSection} className="settings-section motion-item">
            {activeSection === "general" ? (
            <div className="card">
              <div className="card-title">Development</div>

              <div className="grid2">
                <label className="field">
                  <div className="field-label">Console host</div>
                  <input
                    className="select"
                    value={draft.consoleHost}
                    onChange={(e) => setDraft((d) => ({ ...d, consoleHost: e.target.value }))}
                    placeholder="127.0.0.1 or 0.0.0.0"
                    spellCheck={false}
                    disabled={cfgLoading || !cfgBase}
                  />
                </label>

                <label className="field">
                  <div className="field-label">Console port</div>
                  <input
                    className="select"
                    value={draft.consolePort}
                    onChange={(e) => setDraft((d) => ({ ...d, consolePort: e.target.value }))}
                    placeholder="5173"
                    inputMode="numeric"
                    spellCheck={false}
                    disabled={cfgLoading || !cfgBase}
                  />
                </label>
              </div>

              <div className="row stack-gap">
                <div className="row-left">
                  <div className="row-main">Session Sync</div>
                  <div className="row-sub muted">Best-effort hydration of sessions/messages from the local gateway.</div>
                </div>

                <input
                  type="checkbox"
                  checked={draft.sessionSyncEnabled}
                  onChange={(e) => setDraft((d) => ({ ...d, sessionSyncEnabled: e.target.checked }))}
                  aria-label="Enable session sync"
                />
              </div>

              <div className="row stack-gap">
                <div className="row-left">
                  <div className="row-main">Display Plain Output</div>
                  <div className="row-sub muted">
                    Show full raw tool payloads (tool_call/tool_result) and show &lt;think&gt; blocks inline.
                  </div>
                </div>

                <input
                  type="checkbox"
                  checked={draft.displayPlainOutput}
                  onChange={(e) => setDraft((d) => ({ ...d, displayPlainOutput: e.target.checked }))}
                  aria-label="Display plain output"
                />
              </div>

              <div className="row stack-gap">
                <div className="row-left">
                  <div className="row-main">Capture Upstream Requests</div>
                  <div className="row-sub muted">
                    Save the full upstream request body to <code>.eclia/debug/&lt;sessionId&gt;/</code> for debugging.
                  </div>
                </div>

                <input
                  type="checkbox"
                  checked={draft.debugCaptureUpstreamRequests}
                  onChange={(e) => setDraft((d) => ({ ...d, debugCaptureUpstreamRequests: e.target.checked }))}
                  aria-label="Capture upstream requests"
                  disabled={cfgLoading || !cfgBase}
                />
              </div>

              {cfgError ? <div className="devNoteText muted">{cfgError}</div> : null}

              {dirtyDevHostPort && !hostPortValid ? (
                <div className="devNoteText muted">Invalid host or port. Port must be 1–65535.</div>
              ) : null}

              {cfgSaved ? <div className="devNoteText muted">{cfgSaved}</div> : null}
            </div>
            ) : null}

            {activeSection === "appearance" ? (
            <div>
              <div className="card-title">Appearance</div>

              <div className="row">
                <div className="row-left">
                  <div className="row-main">Disable background texture</div>
                  <div className="row-sub muted">{webgl2Text}</div>
                </div>

                <input
                  type="checkbox"
                  checked={draft.textureDisabled}
                  onChange={(e) => setDraft((d) => ({ ...d, textureDisabled: e.target.checked }))}
                  aria-label="Disable background texture"
                />
              </div>
            </div>
            ) : null}

            {activeSection === "inference" ? (
            <>
              <div className="card">
                <div className="card-title">Runtime</div>

                <div className="grid2">
                  <label className="field">
                    <div className="field-label">Transport</div>
                    <select
                      className="select"
                      value={draft.transport}
                      onChange={(e) => setDraft((d) => ({ ...d, transport: e.target.value as TransportId }))}
                    >
                      {transports.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <div className="field-label">Provider</div>
                    <select
                      className="select"
                      value={draft.model}
                      onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                      disabled={!draft.inferenceProfiles.length && !codexProfiles.length}
                    >
                      {draft.inferenceProfiles.length || codexProfiles.length ? (
                        <>
                          {draft.inferenceProfiles.length ? (
                            <optgroup label="OpenAI-compatible">
                              {draft.inferenceProfiles.map((p) => (
                                <option key={p.id} value={openaiProfileRoute(p.id)}>
                                  {p.name.trim() || "Untitled"}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}

                          {codexProfiles.length ? (
                            <optgroup label="Codex OAuth">
                              {codexProfiles.map((p) => (
                                <option key={p.id} value={codexProfileRoute(p.id)}>
                                  {p.name.trim() || "Untitled"}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </>
                      ) : (
                        <option value={draft.model || "openai-compatible"}>{draft.model || "openai-compatible"}</option>
                      )}
                    </select>
                  </label>

                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <div className="field-label">Context limit (tokens)</div>

                    <div className="contextLimitRow">
                      <input
                        className="select contextLimitInput"
                        inputMode="numeric"
                        type="number"
                        min={256}
                        max={1000000}
                        step={256}
                        value={draft.contextTokenLimit}
                        onChange={(e) => setDraft((d) => ({ ...d, contextTokenLimit: e.target.value }))}
                        disabled={!draft.contextLimitEnabled}
                      />

                      <label className="inlineToggle" title="Enable/disable sending a truncation budget to the gateway">
                        <input
                          type="checkbox"
                          checked={draft.contextLimitEnabled}
                          onChange={(e) => setDraft((d) => ({ ...d, contextLimitEnabled: e.target.checked }))}
                        />
                        <span>Enabled</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

            <div className="settings-subtitle">Provider Settings</div>

              <div className="card">
                <div className="card-title">OpenAI-compatible profiles</div>

                {draft.inferenceProfiles.map((p) => {
                  const isExpanded = expandedOpenAICompatProfileId === p.id;
                  const isActivated = draft.model === openaiProfileRoute(p.id);
                  const apiKeyConfigured =
                    cfgBase?.openaiCompatProfiles.find((x) => x.id === p.id)?.apiKeyConfigured ?? false;
                  const profileValid = p.name.trim().length > 0 && p.baseUrl.trim().length > 0 && p.modelId.trim().length > 0;

                  return (
                    <div key={p.id} className="profileItem">
                      <button
                        type="button"
                        className="row profileRow"
                        onClick={() =>
                          setExpandedOpenAICompatProfileId((cur) => (cur === p.id ? null : p.id))
                        }
                        aria-expanded={isExpanded}
                      >
                        <div className="row-left">
                          <div className="row-main profileRowTitle">
                            <span className="disclosureIcon" aria-hidden="true">
                              {isExpanded ? "▾" : "▸"}
                            </span>
                            {p.name.trim() || "Untitled"}
                          </div>
                        </div>

                        <div className="row-right">{isActivated ? <span className="activatedPill">Activated</span> : null}</div>
                      </button>

                      {isExpanded ? (
                        <div className="profileDetails">
                          <div className="grid2">
                            <label className="field">
                              <div className="field-label">Name</div>
                              <input
                                className="select"
                                value={p.name}
                                onChange={(e) => patchOpenAICompatProfile(p.id, { name: e.target.value })}
                                placeholder="Minimax"
                                spellCheck={false}
                                disabled={cfgLoading || !cfgBase}
                              />
                            </label>

                            <label className="field">
                              <div className="field-label">API key (local)</div>
                              <input
                                className="select"
                                type="password"
                                value={p.apiKey}
                                onChange={(e) => patchOpenAICompatProfile(p.id, { apiKey: e.target.value })}
                                placeholder={apiKeyConfigured ? "configured (leave blank to keep)" : "not set"}
                                spellCheck={false}
                                disabled={cfgLoading || !cfgBase}
                              />
                              <div className="field-sub muted">
                                {apiKeyConfigured
                                  ? "A key is already configured (not shown). Enter a new one to replace it."
                                  : "No key detected. Set it here or in eclia.config.local.toml."}
                              </div>
                            </label>
                          </div>

                          <div className="grid2">
                            <label className="field">
                              <div className="field-label">Base URL</div>
                              <input
                                className="select"
                                value={p.baseUrl}
                                onChange={(e) => patchOpenAICompatProfile(p.id, { baseUrl: e.target.value })}
                                placeholder="https://api.openai.com/v1"
                                spellCheck={false}
                                disabled={cfgLoading || !cfgBase}
                              />
                            </label>

                            <label className="field">
                              <div className="field-label">Model</div>
                              <input
                                className="select"
                                value={p.modelId}
                                onChange={(e) => patchOpenAICompatProfile(p.id, { modelId: e.target.value })}
                                placeholder="gpt-4o-mini"
                                spellCheck={false}
                                disabled={cfgLoading || !cfgBase}
                              />
                            </label>
                          </div>

                          <div className="profileActions">
                            <button
                              type="button"
                              className="btn subtle"
                              onClick={() => deleteOpenAICompatProfile(p.id)}
                              disabled={cfgLoading || !cfgBase || draft.inferenceProfiles.length <= 1}
                            >
                              Delete profile
                            </button>
                          </div>

                          {dirtyDevInference && !profileValid ? (
                            <div className="devNoteText muted">Missing required fields.</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                <div className="profileActions">
                  <button type="button" className="btn subtle" onClick={newOpenAICompatProfile} disabled={cfgLoading || !cfgBase}>
                    New profile
                  </button>
                </div>

                {dirtyDevInference && !inferenceValid ? <div className="devNoteText muted">Invalid provider profile settings.</div> : null}
              </div>

              <div className="card">
                <div className="card-title">Codex OAuth</div>

                <div className="devNoteText muted" style={{ marginBottom: 12 }}>
                  Browser login is handled by <code>codex app-server</code> and the resulting session is stored by Codex
                  itself. ECLIA only persists profile metadata (name/model) in <code>eclia.config.local.toml</code>.
                </div>

                <div className="row" style={{ marginBottom: 12 }}>
                  <div className="row-left">
                    <div className="row-main">Availability</div>
                    <div className="row-sub muted">
                      Checks authentication via <code>account/read</code> and model availability via <code>model/list</code>.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn subtle"
                    onClick={refreshCodexStatus}
                    disabled={cfgLoading || !cfgBase || codexStatusLoading}
                  >
                    {codexStatusLoading ? "Checking…" : "Refresh status"}
                  </button>
                </div>

                
                {codexProfiles.length ? (() => {
                  const p = codexProfiles[0];
                  const isBusy = codexLoginBusyProfileId === p.id;
                  const isActivated = draft.model === codexProfileRoute(p.id);

                  const availability = (() => {
                    if (codexStatusLoading) return { label: "Checking…", detail: null as string | null };
                    if (codexStatusError) return { label: "Unavailable", detail: codexStatusError };
                    if (!codexStatus) return { label: "Unknown", detail: "Click “Refresh status” to run a check." };

                    const requires = codexStatus.requires_openai_auth === true;
                    const acctType = codexStatus.account?.type ? String(codexStatus.account.type) : "";
                    const authed = !requires || !!acctType;
                    if (!authed) {
                      return {
                        label: "Needs login",
                        detail: "Codex is not authenticated. Click “Login with browser”."
                      };
                    }

                    const models = codexStatus.models;
                    if (Array.isArray(models) && models.length && !models.includes(p.model)) {
                      return {
                        label: "Model not available",
                        detail: `Model “${p.model}” was not found in Codex model catalog.`
                      };
                    }

                    const acct = codexStatus.account;
                    const who = acct
                      ? `${acct.type}${acct.planType ? `/${acct.planType}` : ""}${acct.email ? ` (${acct.email})` : ""}`
                      : "authenticated";
                    return { label: "Ready", detail: `Authenticated via ${who}.` };
                  })();

                  return (
                    <>
                      <div className="grid2">
                        <label className="field">
                          <div className="field-label">Name</div>
                          <input
                            className="select"
                            value={p.name}
                            onChange={(e) => patchCodexProfile(p.id, { name: e.target.value })}
                            placeholder="Default"
                            spellCheck={false}
                            disabled={cfgLoading || !cfgBase}
                          />
                        </label>

                        <label className="field">
                          <div className="field-label">Model</div>
                          <input
                            className="select"
                            value={p.model}
                            onChange={(e) => patchCodexProfile(p.id, { model: e.target.value })}
                            placeholder="gpt-5.2-codex"
                            spellCheck={false}
                            disabled={cfgLoading || !cfgBase}
                          />
                        </label>
                      </div>

                      <div className="profileActions profileActionsRow">
                        <div className="profileActionsLeft">
                          <button
                            type="button"
                            className="btn subtle"
                            onClick={() => startCodexBrowserLogin(p.id)}
                            disabled={cfgLoading || !cfgBase || codexLoginBusyProfileId !== null}
                          >
                            {isBusy ? "Starting…" : "Login with browser"}
                          </button>

                          <button
                            type="button"
                            className="btn subtle"
                            onClick={clearCodexOAuthConfig}
                            disabled={cfgLoading || !cfgBase || codexLoginBusyProfileId !== null}
                          >
                            Sign out &amp; reset
                          </button>
                        </div>

                        {isActivated ? <span className="activatedPill">Activated</span> : null}
                      </div>

                      <div className="devNoteText muted">
                        Availability: {availability.label}
                        {availability.detail ? ` — ${availability.detail}` : ""}
                        {codexStatusCheckedAt ? ` · checked ${new Date(codexStatusCheckedAt).toLocaleTimeString()}` : ""}
                      </div>

                      {codexLoginMsg ? <div className="devNoteText muted">{codexLoginMsg}</div> : null}
                    </>
                  );
                })() : (
                  <div className="devNoteText muted">No Codex OAuth configuration found.</div>
                )}
              </div>

              <div className="card">
                <div className="card-title">Ollama</div>
                <div className="devNoteText muted">no configured profiles.</div>
              </div>

              <Collapsible title="Advanced" variant="section">
                <label className="field" style={{ marginBottom: 12 }}>
                  <div className="field-label">Modify System Instruction</div>
                  <textarea
                    className="select"
                    rows={6}
                    value={draft.inferenceSystemInstruction}
                    onChange={(e) => setDraft((d) => ({ ...d, inferenceSystemInstruction: e.target.value }))}
                    placeholder="(optional)"
                    spellCheck={false}
                    disabled={cfgLoading || !cfgBase}
                  />
                  <div className="field-sub muted">
                    Injected as the only <code>system</code> message (role=system) for all providers. Saved to <code>eclia.config.local.toml</code>.
                  </div>
                </label>

                <div className="row">
                  <div className="row-left">
                    <div className="row-main">ECLIA_CODEX_HOME override</div>
                    <div className="row-sub muted">
                      Overrides <code>CODEX_HOME</code> for the spawned <code>codex app-server</code>. Leave off to use the default
                      isolated directory.
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={draft.codexHomeOverrideEnabled}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        codexHomeOverrideEnabled: e.target.checked,
                        codexHomeOverridePath: e.target.checked ? d.codexHomeOverridePath : ""
                      }))
                    }
                    aria-label="Override ECLIA_CODEX_HOME"
                    disabled={cfgLoading || !cfgBase}
                  />
                </div>

                {draft.codexHomeOverrideEnabled ? (
                  <label className="field" style={{ marginTop: 10 }}>
                    <div className="field-label">Directory</div>
                    <div className="fieldInline">
                      <input
                        className="select"
                        value={draft.codexHomeOverridePath}
                        onChange={(e) => setDraft((d) => ({ ...d, codexHomeOverridePath: e.target.value }))}
                        placeholder={cfgBase?.codexHome?.trim().length ? cfgBase.codexHome : "<repo>/.codex"}
                        spellCheck={false}
                        disabled={cfgLoading || !cfgBase}
                      />

                      <button
                        type="button"
                        className="btn subtle"
                        onClick={pickCodexHome}
                        disabled={cfgLoading || !cfgBase || codexHomePickBusy}
                      >
                        {codexHomePickBusy ? "Browsing…" : "Browse…"}
                      </button>
                    </div>
                    <div className="field-sub muted">
                      Saved to <code>eclia.config.local.toml</code>. Restart required.
                    </div>
                  </label>
                ) : null}

                {codexHomePickMsg ? <div className="devNoteText muted">{codexHomePickMsg}</div> : null}

                {dirtyDevCodexHome && !codexHomeValid ? (
                  <div className="devNoteText muted">Please select or enter a directory path.</div>
                ) : null}
              </Collapsible>
            </>
            ) : null}

            {activeSection === "adapters" ? (
            <>
              <div className="card">
                <div className="card-title">Discord</div>

                <div className="row">
                  <div className="row-left">
                    <div className="row-main">Discord adapter</div>
                    <div className="row-sub muted">Enables the Discord bot adapter.</div>
                  </div>

                  <input
                    type="checkbox"
                    checked={draft.adapterDiscordEnabled}
                    onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordEnabled: e.target.checked }))}
                    aria-label="Enable Discord adapter"
                    disabled={cfgLoading || !cfgBase}
                  />
                </div>

                <div className="grid2">
                  <label className="field">
                    <div className="field-label">Application ID (client id)</div>
                    <input
                      className="select"
                      value={draft.adapterDiscordAppId}
                      onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordAppId: e.target.value }))}
                      placeholder={cfgBase?.discordAppId ? "configured" : "not set"}
                      spellCheck={false}
                      disabled={cfgLoading || !cfgBase}
                    />
                    <div className="field-sub muted">
                      Required for registering slash commands. Find it in the Discord Developer Portal (Application/Client ID).
                    </div>
                  </label>

                  <label className="field">
                    <div className="field-label">Bot token (local)</div>
                    <input
                      className="select"
                      type="password"
                      value={draft.adapterDiscordBotToken}
                      onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordBotToken: e.target.value }))}
                      placeholder={cfgBase?.discordTokenConfigured ? "configured (leave blank to keep)" : "not set"}
                      spellCheck={false}
                      disabled={cfgLoading || !cfgBase}
                    />
                    <div className="field-sub muted">
                      Stored in <code>eclia.config.local.toml</code>. Token is never shown after saving.
                    </div>
                  </label>
                </div>

                <div className="grid2">
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <div className="field-label">Guild IDs (optional)</div>
                    <textarea
                      className="select"
                      rows={3}
                      value={draft.adapterDiscordGuildIds}
                      onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordGuildIds: e.target.value }))}
                      placeholder={"123456789012345678\n987654321098765432"}
                      spellCheck={false}
                      disabled={cfgLoading || !cfgBase}
                    />
                    <div className="field-sub muted">
                      If set, slash commands will be registered as <strong>guild</strong> commands for faster iteration. Leave blank for global registration.
                    </div>
                  </label>
                </div>

                {dirtyDevDiscord && !discordValid ? (
                  <div className="devNoteText muted">Discord adapter enabled but missing bot token or Application ID.</div>
                ) : null}
              </div>

              <Collapsible title="Advanced" variant="section">
                <div className="row">
                  <div className="row-left">
                    <div className="row-main">Discord verbose default</div>
                    <div className="row-sub muted">
                      When enabled, <code>/eclia</code> behaves as if <code>verbose=true</code> was set by default (equivalent to setting{" "}
                      <code>ECLIA_DISCORD_DEFAULT_STREAM_MODE=full</code>). Saved to <code>eclia.config.local.toml</code>. Restart required.
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={draft.adapterDiscordDefaultStreamMode === "full"}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        adapterDiscordDefaultStreamMode: e.target.checked ? "full" : "final"
                      }))
                    }
                    aria-label="Discord verbose default"
                    disabled={cfgLoading || !cfgBase}
                  />
                </div>
              </Collapsible>
            </>
            ) : null}

            {activeSection === "skills" ? (
            <>
              <div className="card">
                <div className="card-title">Skills</div>

                <div className="devNoteText muted">
                  Skills are stored under <code>skills/&lt;name&gt;/skill.md</code>. Skill names are strict: the config name, the registered name, and the directory name must match exactly.
                </div>

                {!cfgBase ? (
                  <div className="devNoteText muted">Config service unavailable. Start the backend (pnpm dev:all) to edit skills.</div>
                ) : cfgBase.skillsAvailable.length === 0 ? (
                  <div className="devNoteText muted">
                    No skills discovered. Create a folder like <code>skills/my-skill/</code> with a <code>skill.md</code> inside.
                  </div>
                ) : (
                  <div className="stack">
                    {cfgBase.skillsAvailable.map((s) => {
                      const enabled = draft.skillsEnabled.includes(s.name);

                      return (
                        <div key={s.name} className="row stack-gap">
                          <div className="row-left">
                            <div className="row-main">{s.name}</div>
                            <div className="row-sub muted">{s.summary || "(no summary)"}</div>
                          </div>

                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setDraft((d) => {
                                const cur = Array.isArray(d.skillsEnabled) ? d.skillsEnabled : [];
                                const next = new Set(cur);
                                if (on) next.add(s.name);
                                else next.delete(s.name);
                                return { ...d, skillsEnabled: Array.from(next).sort((a, b) => a.localeCompare(b)) };
                              });
                            }}
                            aria-label={`Enable skill ${s.name}`}
                            disabled={cfgLoading || !cfgBase}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="devNoteText muted">
                  Tip: to customize the short "skill system" blurb injected into the model's system instruction, create <code>skills/_system.md</code> (kept short; not required).
                </div>
              </div>
            </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
