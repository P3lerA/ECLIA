import React from "react";

import { SettingsToggleRow } from "../../components/SettingsToggleRow";
import type { SettingsDraft } from "../../settingsTypes";

export type SymphonySectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  cfgLoading: boolean;
  cfgBaseAvailable: boolean;
  dirtyDevSymphony: boolean;
  symphonyValid: boolean;
};

export function SymphonySection(props: SymphonySectionProps) {
  const { draft, setDraft, cfgLoading, cfgBaseAvailable, dirtyDevSymphony, symphonyValid } = props;

  const devDisabled = cfgLoading || !cfgBaseAvailable;

  return (
    <>
      {!cfgBaseAvailable ? (
        <div className="devNoteText muted">Config service unavailable. Start the backend (pnpm dev:all) to edit Symphony settings.</div>
      ) : null}

      <SettingsToggleRow
        title="Enable Symphony"
        checked={draft.symphonyEnabled}
        onCheckedChange={(enabled) => setDraft((d) => ({ ...d, symphonyEnabled: enabled }))}
        ariaLabel="Enable Symphony flow engine"
        disabled={devDisabled}
      />

      {dirtyDevSymphony && !symphonyValid ? (
        <div className="devNoteText" style={{ color: "var(--danger)" }}>
          Symphony settings are invalid. Provide a valid port.
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">Server</div>

        <div className="grid2">
          <label className="field">
            <div className="field-label">Host</div>
            <input
              className="select"
              value={draft.symphonyHost}
              onChange={(e) => setDraft((d) => ({ ...d, symphonyHost: e.target.value }))}
              placeholder="127.0.0.1"
              spellCheck={false}
              disabled={devDisabled}
            />
          </label>

          <label className="field">
            <div className="field-label">Port</div>
            <input
              className="select"
              value={draft.symphonyPort}
              onChange={(e) => setDraft((d) => ({ ...d, symphonyPort: e.target.value }))}
              placeholder="8800"
              inputMode="numeric"
              spellCheck={false}
              disabled={devDisabled}
            />
          </label>
        </div>
      </div>

      <div className="devNoteText muted">
        Symphony is a visual workflow engine for composing reactive DAG pipelines. Changes require restarting <code>dev:all</code>.
      </div>
    </>
  );
}
