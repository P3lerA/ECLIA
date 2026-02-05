import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";

type PluginsDraft = Record<string, boolean>;

/**
 * Plugins uses an explicit "Save" to commit changes.
 * While dirty, leaving the page is blocked to avoid accidental loss.
 */
export function PluginsView({ onBack }: { onBack: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const [draft, setDraft] = React.useState<PluginsDraft>(() => {
    const map: PluginsDraft = {};
    for (const p of state.plugins) map[p.id] = p.enabled;
    return map;
  });

  const dirty = state.plugins.some((p) => (draft[p.id] ?? p.enabled) !== p.enabled);

  // Keep draft in sync when external state changes, but only if not dirty.
  React.useEffect(() => {
    if (dirty) return;
    const map: PluginsDraft = {};
    for (const p of state.plugins) map[p.id] = p.enabled;
    setDraft(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.plugins]);

  React.useEffect(() => {
    if (!dirty) return;

    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const discard = () => {
    const map: PluginsDraft = {};
    for (const p of state.plugins) map[p.id] = p.enabled;
    setDraft(map);
  };

  const save = () => {
    if (!dirty) return;
    for (const p of state.plugins) {
      const nextEnabled = draft[p.id] ?? p.enabled;
      if (nextEnabled !== p.enabled) {
        dispatch({ type: "plugin/toggle", pluginId: p.id });
      }
    }
  };

  const back = () => {
    if (dirty) return;
    onBack();
  };

  return (
    <div className="settingsview motion-page">
      <div className="settings-head">
        <button className="btn icon" onClick={back} aria-label="Back" disabled={dirty}>
          ←
        </button>

        <div className="settings-head-title">
          <div className="brand brand-md" data-text="ECLIA">
            ECLIA
          </div>
          <div className="settings-title">Plugins</div>
        </div>

        <div className="settings-head-actions">
          {dirty && (
            <div className="saveIndicator" role="status" aria-live="polite">
              <span className="saveDot" aria-hidden="true" />
              Unsaved changes
            </div>
          )}

          <button className="btn subtle" onClick={discard} disabled={!dirty} aria-label="Discard changes">
            Discard
          </button>

          <button className="btn subtle" onClick={save} disabled={!dirty} aria-label="Save plugins">
            Save
          </button>

          <ThemeModeSwitch compact />
        </div>
      </div>

      <div className="settings-body">
        <div className="card">
          <div className="card-title">Installed</div>

          {state.plugins.map((p) => (
            <div key={p.id} className="row">
              <div className="row-left">
                <div className="row-main">{p.name}</div>
                <div className="row-sub">{p.description ?? ""}</div>
              </div>

              <input
                type="checkbox"
                checked={draft[p.id] ?? p.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.checked }))}
                aria-label={`Toggle ${p.name}`}
              />
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Notes</div>
          <div className="row">
            <div className="row-left">
              <div className="row-main">Prototype mode</div>
              <div className="row-sub">
                Changes are staged until you click Save. Plugin manifests, permissions, and per-plugin settings will be
                added later.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
