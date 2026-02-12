import React from "react";
import { runtime } from "../../core/runtime";
import type { TransportId } from "../../core/transport/TransportRegistry";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { useStagedDraft } from "../common/useStagedDraft";

type SettingsDraft = {
  textureDisabled: boolean;
  transport: TransportId;
  model: string;
  contextTokenLimit: string;
  contextLimitEnabled: boolean;

  // Dev-only (written to eclia.config.local.toml via the local backend).
  consoleHost: string;
  consolePort: string; // keep as string for input UX

  // Inference (OpenAI-compatible). Secrets are stored in local TOML; key is never read back.
  inferenceBaseUrl: string;
  inferenceModelId: string;
  inferenceApiKey: string; // input only; empty = unchanged

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
      base_url?: string;
      model?: string;
      api_key_configured?: boolean;
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
    inferenceBaseUrl: string;
    inferenceModelId: string;
    apiKeyConfigured: boolean;

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
        const baseUrl = String(inf.base_url ?? "https://api.openai.com/v1");
        const modelId = String(inf.model ?? "gpt-4o-mini");
        const keyConfigured = Boolean(inf.api_key_configured);

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
          inferenceBaseUrl: baseUrl,
          inferenceModelId: modelId,
          apiKeyConfigured: keyConfigured,
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
        transport: state.transport,
        model: state.model,
        contextTokenLimit: String(state.settings.contextTokenLimit ?? 20000),
        contextLimitEnabled: Boolean(state.settings.contextLimitEnabled ?? true),

        consoleHost: cfgBase?.host ?? prev?.consoleHost ?? "",
        consolePort: cfgBase ? String(cfgBase.port) : prev?.consolePort ?? "",

        inferenceBaseUrl: cfgBase?.inferenceBaseUrl ?? prev?.inferenceBaseUrl ?? "",
        inferenceModelId: cfgBase?.inferenceModelId ?? prev?.inferenceModelId ?? "",
        inferenceApiKey: "",

        adapterDiscordEnabled: cfgBase?.discordEnabled ?? prev?.adapterDiscordEnabled ?? false,
        adapterDiscordAppId: cfgBase?.discordAppId ?? prev?.adapterDiscordAppId ?? "",
        adapterDiscordBotToken: "",
        adapterDiscordGuildIds: cfgBase ? cfgBase.discordGuildIds.join("\n") : prev?.adapterDiscordGuildIds ?? ""
      };
    },
    [
      state.settings.textureDisabled,
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      state.transport,
      state.model,
      cfgBase
    ]
  );

  const isDirtyDraft = React.useCallback(
    (d: SettingsDraft): boolean => {
      const dirtyUi =
        d.textureDisabled !== state.settings.textureDisabled ||
        d.transport !== state.transport ||
        d.model !== state.model ||
        d.contextLimitEnabled !== state.settings.contextLimitEnabled ||
        parseContextLimit(d.contextTokenLimit) !== state.settings.contextTokenLimit;

      const dirtyDevHostPort = cfgBase
        ? d.consoleHost.trim() !== cfgBase.host || portNumber(d.consolePort) !== cfgBase.port
        : false;

      const dirtyDevInference = cfgBase
        ? d.inferenceBaseUrl.trim() !== cfgBase.inferenceBaseUrl ||
          d.inferenceModelId.trim() !== cfgBase.inferenceModelId ||
          d.inferenceApiKey.trim().length > 0
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
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      state.transport,
      state.model,
      cfgBase
    ]
  });

  const dirtyUi =
    draft.textureDisabled !== state.settings.textureDisabled ||
    draft.transport !== state.transport ||
    draft.model !== state.model ||
    draft.contextLimitEnabled !== state.settings.contextLimitEnabled ||
    parseContextLimit(draft.contextTokenLimit) !== state.settings.contextTokenLimit;

  const dirtyDevHostPort = cfgBase
    ? draft.consoleHost.trim() !== cfgBase.host || portNumber(draft.consolePort) !== cfgBase.port
    : false;

  const dirtyDevInference = cfgBase
    ? draft.inferenceBaseUrl.trim() !== cfgBase.inferenceBaseUrl ||
      draft.inferenceModelId.trim() !== cfgBase.inferenceModelId ||
      draft.inferenceApiKey.trim().length > 0
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
  const inferenceValid = draft.inferenceBaseUrl.trim().length > 0 && draft.inferenceModelId.trim().length > 0;

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
          if (!inferenceValid) throw new Error("Invalid inference base URL or model id.");
          body.inference = {
            openai_compat: {
              base_url: draft.inferenceBaseUrl.trim(),
              model: draft.inferenceModelId.trim(),
              // api_key is optional; empty means unchanged.
              ...(draft.inferenceApiKey.trim().length ? { api_key: draft.inferenceApiKey.trim() } : {})
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

          const nextBase = {
            host: body.console?.host ?? cfgBase.host,
            port: body.console?.port ?? cfgBase.port,
            inferenceBaseUrl: body.inference?.openai_compat?.base_url ?? cfgBase.inferenceBaseUrl,
            inferenceModelId: body.inference?.openai_compat?.model ?? cfgBase.inferenceModelId,
            apiKeyConfigured: cfgBase.apiKeyConfigured || Boolean(body.inference?.openai_compat?.api_key),

            discordEnabled: body.adapters?.discord?.enabled ?? cfgBase.discordEnabled,
            discordAppId: body.adapters?.discord?.app_id ?? cfgBase.discordAppId,
            discordTokenConfigured: cfgBase.discordTokenConfigured || Boolean(body.adapters?.discord?.bot_token),
            discordGuildIds: body.adapters?.discord?.guild_ids ?? cfgBase.discordGuildIds
          };

          setCfgBase(nextBase);

          // Clear secret inputs after a successful save so the form becomes clean.
          setDraft((d) => ({
            ...d,
            inferenceApiKey: "",
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
      if (draft.transport !== state.transport) {
        dispatch({ type: "transport/set", transport: draft.transport });
      }
      if (draft.model !== state.model) {
        dispatch({ type: "model/set", model: draft.model });
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
        <div className="card">
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
              <div className="field-label">Model</div>
              <select
                className="select"
                value={draft.model}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              >
                <option value="local/ollama">local/ollama</option>
                <option value="openai-compatible">openai-compatible</option>
                <option value="router/gateway">router/gateway</option>
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

        <div className="card">
          <div className="card-title">Inference (OpenAI-compatible)</div>

          <div className="grid2">
            <label className="field">
              <div className="field-label">Base URL</div>
              <input
                className="select"
                value={draft.inferenceBaseUrl}
                onChange={(e) => setDraft((d) => ({ ...d, inferenceBaseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
                disabled={cfgLoading || !cfgBase}
              />
            </label>

            <label className="field">
              <div className="field-label">Model id</div>
              <input
                className="select"
                value={draft.inferenceModelId}
                onChange={(e) => setDraft((d) => ({ ...d, inferenceModelId: e.target.value }))}
                placeholder="gpt-4o-mini"
                spellCheck={false}
                disabled={cfgLoading || !cfgBase}
              />
            </label>
          </div>

          <div className="grid2">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="field-label">API key (local)</div>
              <input
                className="select"
                type="password"
                value={draft.inferenceApiKey}
                onChange={(e) => setDraft((d) => ({ ...d, inferenceApiKey: e.target.value }))}
                placeholder={cfgBase?.apiKeyConfigured ? "configured (leave blank to keep)" : "not set"}
                spellCheck={false}
                disabled={cfgLoading || !cfgBase}
              />
              <div className="field-sub muted">
                {cfgBase?.apiKeyConfigured
                  ? "A key is already configured (not shown). Enter a new one to replace it."
                  : "No key detected. Set it here or in eclia.config.local.toml."}
              </div>
            </label>
          </div>

          {dirtyDevInference && !inferenceValid ? (
            <div className="devNoteText muted">Invalid inference base URL or model id.</div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-title">Adapters</div>

          <div className="row">
            <div className="row-left">
              <div className="row-main">Discord adapter</div>
              <div className="row-sub muted">
                Enables the Discord bot adapter (inbound + future <code>send</code> tool outbound). Requires restart.
              </div>
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

          {cfgError ? <div className="devNoteText muted">{cfgError}</div> : null}

          {dirtyDevHostPort && !hostPortValid ? (
            <div className="devNoteText muted">Invalid host or port. Port must be 1–65535.</div>
          ) : null}

          {cfgSaved ? <div className="devNoteText muted">{cfgSaved}</div> : null}
        </div>
      </div>
    </div>
  );
}
