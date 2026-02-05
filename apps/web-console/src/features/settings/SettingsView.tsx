import React from "react";
import { runtime } from "../../core/runtime";
import type { TransportId } from "../../core/transport/TransportRegistry";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";

type SettingsDraft = {
  textureDisabled: boolean;
  transport: TransportId;
  model: string;

  // Dev-only (written to eclia.config.local.toml via the local backend).
  consoleHost: string;
  consolePort: string; // keep as string for input UX
};

type DevConfig = {
  console: { host: string; port: number };
  api?: { port: number };
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

/**
 * Settings uses an explicit "Save" to commit changes.
 * While dirty, leaving the page is blocked to avoid accidental loss.
 *
 * Dev config note:
 * - We intentionally write host/port to eclia.config.local.toml (gitignored).
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
  const [cfgBase, setCfgBase] = React.useState<{ host: string; port: number } | null>(null);

  const [draft, setDraft] = React.useState<SettingsDraft>(() => ({
    textureDisabled: state.settings.textureDisabled,
    transport: state.transport,
    model: state.model,
    consoleHost: "",
    consolePort: ""
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

        setCfgBase({ host, port });
        setDraft((d) => ({
          ...d,
          consoleHost: host,
          consolePort: String(port)
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
    draft.model !== state.model;

  const dirtyDev = cfgBase
    ? draft.consoleHost.trim() !== cfgBase.host || portNumber(draft.consolePort) !== cfgBase.port
    : false;

  const dirty = dirtyUi || dirtyDev;

  // Keep draft in sync when external state changes, but only if the user
  // isn't in the middle of editing unsaved changes.
  React.useEffect(() => {
    if (dirty) return;
    setDraft((d) => ({
      ...d,
      textureDisabled: state.settings.textureDisabled,
        transport: state.transport,
      model: state.model
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings.textureDisabled, state.transport, state.model]);

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

  const gpuLine = draft.textureDisabled ? "disabled by settings" : gpuText;

  const [saving, setSaving] = React.useState(false);

  const devValid = draft.consoleHost.trim().length > 0 && isValidPort(draft.consolePort);

  const canSave = dirty && !saving && (!dirtyDev || (devValid && !cfgLoading));

  const discard = () => {
    // Revert draft to the last saved state (AppState + cfgBase).
    setDraft((d) => ({
      ...d,
      textureDisabled: state.settings.textureDisabled,
        transport: state.transport,
      model: state.model,
      consoleHost: cfgBase?.host ?? d.consoleHost,
      consolePort: cfgBase ? String(cfgBase.port) : d.consolePort
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
      // 1) Save TOML dev config first (most likely to fail).
      if (dirtyDev) {
        if (!cfgBase) throw new Error("Config service unavailable.");
        if (!devValid) throw new Error("Invalid host/port.");

        setCfgLoading(true);
        try {
          const body = {
            console: {
              host: draft.consoleHost.trim(),
              port: Number(draft.consolePort)
            }
          };

          const r = await fetch("/api/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });

          const j = (await r.json()) as ConfigResponse;
          if (!j.ok) throw new Error(j.hint ?? j.error);

          const nextBase = { host: body.console.host, port: body.console.port };
          setCfgBase(nextBase);
          setCfgSaved("Saved to eclia.config.local.toml. Restart required to apply host/port changes.");
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
          </div>
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

            {dirtyDev && !devValid ? (
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
                onClick={() => dispatch({ type: "messages/clear", sessionId: state.activeSessionId })}
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
