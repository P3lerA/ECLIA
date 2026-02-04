import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";

export function PluginsView({ onBack }: { onBack: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  return (
    <div className="settingsview motion-page">
      <div className="settings-head">
        <button className="btn icon" onClick={onBack} aria-label="Back">
          ←
        </button>

        <div className="settings-head-title">
          <div className="brand brand-md" data-text="ECLIA">
            ECLIA
          </div>
          <div className="settings-title">Plugins</div>
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
                checked={p.enabled}
                onChange={() => dispatch({ type: "plugin/toggle", pluginId: p.id })}
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
                This page only exposes basic enable/disable toggles. Plugin manifests, permissions, and per-plugin
                settings will be added later.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
