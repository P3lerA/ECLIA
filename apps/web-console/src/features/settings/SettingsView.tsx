import React from "react";
import { runtime } from "../../core/runtime";
import type { TransportId } from "../../core/transport/TransportRegistry";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { useStagedDraft } from "../common/useStagedDraft";

type SettingsDraft = {
  textureDisabled: boolean;
  sessionSyncEnabled: boolean;
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

  // Adapters (Discord). Secrets stored in local TOML; token is never read back.
  adapterDiscordEnabled: boolean;
  adapterDiscordAppId: string; // application id / client id (non-secret)
  adapterDiscordBotToken: string; // input only; empty = unchanged
  adapterDiscordGuildIds: string; // UI input only; newline/comma separated; persisted as adapters.discord.guild_ids
};

type DevConfig = {
  console: { host: string; port: number };
  api?: { port: number };
  inference?: {
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
  };
  adapters?: {
    discord?: {
      enabled?: boolean;
      app_id?: string;
      guild_ids?: string[];
      app_id_configured?: boolean;
      bot_token_configured?: boolean;
    };
  };
};

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

function normalizeActiveModel(current: string, profiles: Array<{ id: string }> | null | undefined): string {
  const k = String(current ?? "").trim();
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
    openaiCompatProfiles: Array<{
      id: string;
      name: string;
      baseUrl: string;
      modelId: string;
      authHeader: string;
      apiKeyConfigured: boolean;
    }>;

    discordEnabled: boolean;
    discordAppId: string;
    discordTokenConfigured: boolean;
    discordGuildIds: string[];
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

        setCfgBase({
          host,
          port,
          openaiCompatProfiles: profiles,
          discordEnabled,
          discordAppId,
          discordTokenConfigured,
          discordGuildIds
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

        adapterDiscordEnabled: cfgBase?.discordEnabled ?? prev?.adapterDiscordEnabled ?? false,
        adapterDiscordAppId: cfgBase?.discordAppId ?? prev?.adapterDiscordAppId ?? "",
        adapterDiscordBotToken: "",
        adapterDiscordGuildIds: cfgBase ? cfgBase.discordGuildIds.join("\n") : prev?.adapterDiscordGuildIds ?? ""
      };
    },
    [
      state.settings.textureDisabled,
      state.settings.sessionSyncEnabled,
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
        d.transport !== state.transport ||
        d.model !== effectiveStateModel ||
        d.contextLimitEnabled !== state.settings.contextLimitEnabled ||
        parseContextLimit(d.contextTokenLimit) !== state.settings.contextTokenLimit;

      const dirtyDevHostPort = cfgBase
        ? d.consoleHost.trim() !== cfgBase.host || portNumber(d.consolePort) !== cfgBase.port
        : false;

      const dirtyDevInference = cfgBase
        ? !sameOpenAICompatProfiles(d.inferenceProfiles, cfgBase.openaiCompatProfiles) ||
          d.inferenceProfiles.some((p) => p.apiKey.trim().length > 0)
        : false;

      const dirtyDevDiscord = cfgBase
        ? d.adapterDiscordEnabled !== cfgBase.discordEnabled ||
          d.adapterDiscordAppId.trim() !== cfgBase.discordAppId ||
          d.adapterDiscordBotToken.trim().length > 0 ||
          !sameStringArray(normalizeGuildIds(d.adapterDiscordGuildIds), cfgBase.discordGuildIds)
        : false;

      return dirtyUi || dirtyDevHostPort || dirtyDevInference || dirtyDevDiscord;
    },
    [
      state.settings.textureDisabled,
      state.settings.sessionSyncEnabled,
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

  const dirtyDevInference = cfgBase
    ? !sameOpenAICompatProfiles(draft.inferenceProfiles, cfgBase.openaiCompatProfiles) ||
      draft.inferenceProfiles.some((p) => p.apiKey.trim().length > 0)
    : false;

  const dirtyDevDiscord = cfgBase
    ? draft.adapterDiscordEnabled !== cfgBase.discordEnabled ||
      draft.adapterDiscordAppId.trim() !== cfgBase.discordAppId ||
      draft.adapterDiscordBotToken.trim().length > 0 ||
      !sameStringArray(normalizeGuildIds(draft.adapterDiscordGuildIds), cfgBase.discordGuildIds)
    : false;

  const dirtyDev = dirtyDevHostPort || dirtyDevInference || dirtyDevDiscord;

  const [saving, setSaving] = React.useState(false);

  const hostPortValid = draft.consoleHost.trim().length > 0 && isValidPort(draft.consolePort);
  const inferenceValid =
    draft.inferenceProfiles.length > 0 &&
    draft.inferenceProfiles.every((p) => p.name.trim().length > 0 && p.baseUrl.trim().length > 0 && p.modelId.trim().length > 0);

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

        if (dirtyDevHostPort) {
          if (!hostPortValid) throw new Error("Invalid host/port.");
          body.console = {
            host: draft.consoleHost.trim(),
            port: Number(draft.consolePort)
          };
        }

        if (dirtyDevInference) {
          if (!inferenceValid) throw new Error("Invalid inference profile settings.");

          body.inference = {
            openai_compat: {
              profiles: draft.inferenceProfiles.map((p) => ({
                id: p.id,
                name: p.name.trim(),
                base_url: p.baseUrl.trim(),
                model: p.modelId.trim(),
                auth_header: p.authHeader.trim() || "Authorization",
                ...(p.apiKey.trim().length ? { api_key: p.apiKey.trim() } : {})
              }))
            }
          };
        }

        if (dirtyDevDiscord) {
          if (!discordValid) throw new Error("Discord adapter enabled but missing bot token or Application ID.");
          const appId = draft.adapterDiscordAppId.trim();
          const guildIds = normalizeGuildIds(draft.adapterDiscordGuildIds);
          const guildIdsDirty = !sameStringArray(guildIds, cfgBase.discordGuildIds);
          body.adapters = {
            discord: {
              enabled: Boolean(draft.adapterDiscordEnabled),
              // app_id is optional; empty means unchanged.
              ...(appId.length && appId !== cfgBase.discordAppId ? { app_id: appId } : {}),
              // bot_token is optional; empty means unchanged.
              ...(draft.adapterDiscordBotToken.trim().length ? { bot_token: draft.adapterDiscordBotToken.trim() } : {}),
              ...(guildIdsDirty ? { guild_ids: guildIds } : {})
            }
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

          const nextBase = {
            host: body.console?.host ?? cfgBase.host,
            port: body.console?.port ?? cfgBase.port,
            openaiCompatProfiles: nextProfiles,

            discordEnabled: body.adapters?.discord?.enabled ?? cfgBase.discordEnabled,
            discordAppId: body.adapters?.discord?.app_id ?? cfgBase.discordAppId,
            discordTokenConfigured: cfgBase.discordTokenConfigured || Boolean(body.adapters?.discord?.bot_token),
            discordGuildIds: body.adapters?.discord?.guild_ids ?? cfgBase.discordGuildIds
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
            adapterDiscordBotToken: "",
            adapterDiscordGuildIds: nextBase.discordGuildIds.join("\n")
          }));

          setCfgSaved(
            dirtyDevHostPort
              ? "Saved to eclia.config.local.toml. Restart required to apply host/port changes."
              : dirtyDevDiscord
                ? "Saved to eclia.config.local.toml. Restart required to apply adapter changes."
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

  React.useEffect(() => {
    if (!draft.inferenceProfiles.length) return;

    const ok = draft.inferenceProfiles.some((p) => openaiProfileRoute(p.id) === draft.model);
    if (ok) return;

    const next = openaiProfileRoute(draft.inferenceProfiles[0].id);
    if (draft.model !== next) {
      setDraft((d) => ({ ...d, model: next }));
    }
  }, [draft.inferenceProfiles, draft.model, setDraft]);

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
    const id =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null) ??
      `p_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;

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
                    <div className="field-label">provider</div>
                    <select
                      className="select"
                      value={draft.model}
                      onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                      disabled={!draft.inferenceProfiles.length}
                    >
                      {draft.inferenceProfiles.length ? (
                        draft.inferenceProfiles.map((p) => (
                          <option key={p.id} value={openaiProfileRoute(p.id)}>
                            {p.name.trim() || "Untitled"}
                          </option>
                        ))
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
                <div className="card-title">Ollama</div>
                <div className="devNoteText muted">no configured profiles.</div>
              </div>
            </>
            ) : null}

            {activeSection === "adapters" ? (
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
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
