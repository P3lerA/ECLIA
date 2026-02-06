import React from "react";
import { runtime } from "../../core/runtime";
import { apiResetSession } from "../../core/api/sessions";
import type { TransportId } from "../../core/transport/TransportRegistry";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";

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


/**
 * Settings uses an explicit "Save" to commit changes.
 * While dirty, leaving the page is blocked to avoid accidental loss.
 *
 * Dev config note:
 * - We intentionally write startup config to eclia.config.local.toml (gitignored).
 * - eclia.config.toml is the committed defaults and is not modified by the UI.
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
  } | null>(null);

  const [draft, setDraft] = React.useState<SettingsDraft>(() => ({
    textureDisabled: state.settings.textureDisabled,
    transport: state.transport,
    model: state.model,
    contextTokenLimit: String(state.settings.contextTokenLimit ?? 20000),
    contextLimitEnabled: Boolean(state.settings.contextLimitEnabled ?? true),
    consoleHost: "",
    consolePort: "",
    inferenceBaseUrl: "",
    inferenceModelId: "",
    inferenceApiKey: ""
  }));

  // Load TOML config into draft (best-effort).
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

        setCfgBase({
          host,
          port,
          inferenceBaseUrl: baseUrl,
          inferenceModelId: modelId,
          apiKeyConfigured: keyConfigured
        });

        setDraft((d) => ({
          ...d,
          consoleHost: host,
          consolePort: String(port),
          inferenceBaseUrl: baseUrl,
          inferenceModelId: modelId,
          inferenceApiKey: "" // never auto-fill secrets
        }));
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

  const dirtyDev = dirtyDevHostPort || dirtyDevInference;
  const dirty = dirtyUi || dirtyDev;

  // Keep draft in sync when external state changes, but only if the user
  // isn't in the middle of editing unsaved changes.
  React.useEffect(() => {
    if (dirty) return;
    setDraft((d) => ({
      ...d,
      textureDisabled: state.settings.textureDisabled,
      transport: state.transport,
      model: state.model,
      contextLimitEnabled: state.settings.contextLimitEnabled,
      contextTokenLimit: String(state.settings.contextTokenLimit ?? 20000)
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.settings.textureDisabled,
    state.settings.contextLimitEnabled,
    state.settings.contextTokenLimit,
    state.transport,
    state.model
  ]);

  // Prevent accidental tab close / refresh while there are unsaved changes.
  React.useEffect(() => {
    if (!dirty) return;

    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const gpuText =
    state.gpu.available === null ? "checking…" : state.gpu.available ? "WebGL2 available" : "unavailable";

  const gpuLine = draft.textureDisabled ? "Texture disabled (solid background)" : gpuText;

  const [saving, setSaving] = React.useState(false);

  const hostPortValid = draft.consoleHost.trim().length > 0 && isValidPort(draft.consolePort);
  const inferenceValid = draft.inferenceBaseUrl.trim().length > 0 && draft.inferenceModelId.trim().length > 0;

  const canSave =
    dirty &&
    !saving &&
    (!dirtyDev ||
      (!!cfgBase &&
        !cfgLoading &&
        (!dirtyDevHostPort || hostPortValid) &&
        (!dirtyDevInference || inferenceValid)));

  const discard = () => {
    // Revert draft to the last saved state (AppState + cfgBase).
    setDraft((d) => ({
      ...d,
      textureDisabled: state.settings.textureDisabled,
      transport: state.transport,
      model: state.model,
      contextLimitEnabled: state.settings.contextLimitEnabled,
      contextTokenLimit: String(state.settings.contextTokenLimit ?? 20000),
      consoleHost: cfgBase?.host ?? d.consoleHost,
      consolePort: cfgBase ? String(cfgBase.port) : d.consolePort,
      inferenceBaseUrl: cfgBase?.inferenceBaseUrl ?? d.inferenceBaseUrl,
      inferenceModelId: cfgBase?.inferenceModelId ?? d.inferenceModelId,
      inferenceApiKey: ""
    }));
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
            apiKeyConfigured: cfgBase.apiKeyConfigured || Boolean(body.inference?.openai_compat?.api_key)
          };

          setCfgBase(nextBase);
          setDraft((d) => ({ ...d, inferenceApiKey: "" }));

          setCfgSaved(
            dirtyDevHostPort
              ? "Saved to eclia.config.local.toml. Restart required to apply host/port changes."
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
              <div className="row-sub muted">Solid background fallback (useful for low-end GPUs).</div>
            </div>

            <input
              type="checkbox"
              checked={draft.textureDisabled}
              onChange={(e) => setDraft((d) => ({ ...d, textureDisabled: e.target.checked }))}
              aria-label="Disable background texture"
            />
          </div>

          <div className="row">
            <div className="row-left">
              <div className="row-main">GPU status</div>
              <div className="row-sub muted">{gpuLine}</div>
            </div>
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

              <div className="hint">
                {draft.contextLimitEnabled
                  ? "Approximate truncation budget sent to the gateway (estimator-based)."
                  : "No truncation budget is applied (full session context is sent; may exceed provider limits)."}
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
            <label className="field">
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

            <div className="field">
              <div className="field-label">Status</div>
              <div className="field-sub muted">
                {cfgBase?.apiKeyConfigured ? "API key configured" : "API key missing"}
              </div>
              <div className="field-sub muted">
                Tip: If you're using Minimax, set the correct Base URL for their OpenAI-compatible endpoint.
              </div>
            </div>
          </div>

          {dirtyDevInference && !inferenceValid ? (
            <div className="devNoteText muted">Invalid inference base URL or model id.</div>
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

          <div className="devNote">
            <div className="devNoteTitle">TOML config</div>
            <div className="devNoteText">
              Writes to <code>eclia.config.local.toml</code>. Restart required to apply host/port changes.
            </div>

            {cfgError ? <div className="devNoteText muted">{cfgError}</div> : null}

            {dirtyDevHostPort && !hostPortValid ? (
              <div className="devNoteText muted">Invalid host or port. Port must be 1–65535.</div>
            ) : null}

            {cfgSaved ? <div className="devNoteText muted">{cfgSaved}</div> : null}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Diagnostics</div>

          <div className="menu-diag">
            <div className="menu-diag-row">
              <div className="muted">events</div>
              <div className="muted">{state.logsByTab.events[0]?.summary ?? "-"}</div>
            </div>
            <div className="menu-diag-row">
              <div className="muted">tools</div>
              <div className="muted">{state.logsByTab.tools[0]?.summary ?? "-"}</div>
            </div>
            <div className="menu-diag-row">
              <div className="muted">context</div>
              <div className="muted">{state.logsByTab.context[0]?.summary ?? "-"}</div>
            </div>

            <div className="menu-diag-actions">
              <button
                className="btn subtle"
                onClick={async () => {
                  try {
                    await apiResetSession(state.activeSessionId);
                  } catch {
                    // ignore
                  }
                  dispatch({ type: "messages/clear", sessionId: state.activeSessionId });
                }}
              >
                Reset active session
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">About</div>
          <div className="row">
            <div className="row-left">
              <div className="row-main">ECLIA Console Prototype</div>
              <div className="row-sub">WebGL2 dynamic contours · Menu navigation · blocks/event-stream architecture</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
