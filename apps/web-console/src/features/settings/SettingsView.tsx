import React from "react";
import { runtime } from "../../core/runtime";
import type { TransportId } from "../../core/transport/TransportRegistry";
import { useAppDispatch, useAppState } from "../../state/AppState";

export function SettingsView({ onBack }: { onBack: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const transports = runtime.transports.list();

  const gpuText =
    state.gpu.available === null ? "checking…" : state.gpu.available ? "WebGL2 available" : "unavailable";

  return (
    <div className="settingsview motion-page">
      <div className="settings-head">
        <button className="btn icon" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="settings-head-title">
          <div className="brand brand-sm" data-text="ECLIA">
            ECLIA
          </div>
          <div className="settings-title">Settings</div>
        </div>
      </div>

      <div className="settings-body">
        <div className="card">
          <div className="card-title">Appearance</div>

          <div className="row">
            <div className="row-left">
              <div className="row-main">Static contour fallback</div>
              <div className="row-sub">
                Show a static contour texture when GPU is unavailable. CPU contour generation (noise → isolines) will come later; for now this uses a built-in placeholder texture.
              </div>
            </div>
            <input
              type="checkbox"
              checked={state.settings.staticContourFallback}
              onChange={(e) =>
                dispatch({ type: "settings/staticFallback", enabled: e.target.checked })
              }
              aria-label="Static contour fallback"
            />
          </div>

          <div className="row">
            <div className="row-left">
              <div className="row-main">GPU status</div>
              <div className="row-sub muted">{gpuText}</div>
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
                value={state.transport}
                onChange={(e) =>
                  dispatch({ type: "transport/set", transport: e.target.value as TransportId })
                }
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
                value={state.model}
                onChange={(e) => dispatch({ type: "model/set", model: e.target.value })}
              >
                <option value="local/ollama">local/ollama</option>
                <option value="openai-compatible">openai-compatible</option>
                <option value="router/gateway">router/gateway</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-title">About</div>
          <div className="row">
            <div className="row-left">
              <div className="row-main">ECLIA Console Prototype</div>
              <div className="row-sub">WebGL2 dynamic contours · MenuSheet navigation · blocks/event-stream architecture</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
