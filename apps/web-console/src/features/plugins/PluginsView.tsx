import React from "react";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";

/**
 * Placeholder screen.
 *
 * The original plugins UI was removed during cleanup. We'll re-introduce
 * specific controls (e.g. Session Sync) inside Settings later.
 */
export function PluginsView({ onBack }: { onBack: () => void }) {
  const back = () => {
    onBack();
  };

  return (
    <div className="settingsview motion-page">
      <div className="settings-head">
        <button className="btn icon" onClick={back} aria-label="Back">
          ←
        </button>

        <div className="settings-head-title">
          <div className="brand brand-md" data-text="ECLIA">
            ECLIA
          </div>
          <div className="settings-title">Plugins</div>
        </div>

        <div className="settings-head-actions">
          <button className="btn subtle" disabled aria-label="Discard changes">
            Discard
          </button>

          <button className="btn subtle" disabled aria-label="Save plugins">
            Save
          </button>

          <ThemeModeSwitch compact />
        </div>
      </div>

      <div className="settings-body" />
    </div>
  );
}
