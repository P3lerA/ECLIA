import React from "react";

import { SettingsToggleRow } from "../../settings/components/SettingsToggleRow";
import type { SettingsDraft } from "../../settings/settingsTypes";

export type MemorySettingsSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  cfgBaseAvailable: boolean;
  cfgError: string | null;
  devDisabled: boolean;
  dirty: boolean;
  valid: boolean;
};

export function MemorySettingsSection(props: MemorySettingsSectionProps) {
  const {
    draft,
    setDraft,
    cfgError,
    cfgBaseAvailable,
    devDisabled,
    dirty,
    valid
  } = props;

  return (
    <>
      {!cfgBaseAvailable ? (
        <div className="devNoteText muted">Config service unavailable. Start the backend (pnpm dev:all) to edit memory settings.</div>
      ) : null}

      {cfgError ? (
        <div className="devNoteText" style={{ color: "var(--danger)" }}>
          {cfgError}
        </div>
      ) : null}

      <SettingsToggleRow
        title="Enable memory"
        checked={draft.memoryEnabled}
        onCheckedChange={(enabled) => setDraft((d) => ({ ...d, memoryEnabled: enabled }))}
        ariaLabel="Enable memory"
        disabled={devDisabled}
      />

      {dirty && !valid ? (
        <div className="devNoteText" style={{ color: "var(--danger)" }}>
          Memory settings are invalid. Provide a host and valid port.
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">Server</div>

        <div className="grid2">
          <label className="field">
            <div className="field-label">Host</div>
            <input
              className="select"
              value={draft.memoryHost}
              onChange={(e) => setDraft((d) => ({ ...d, memoryHost: e.target.value }))}
              placeholder="127.0.0.1"
              spellCheck={false}
              disabled={devDisabled}
            />
          </label>

          <label className="field">
            <div className="field-label">Port</div>
            <input
              className="select"
              value={draft.memoryPort}
              onChange={(e) => setDraft((d) => ({ ...d, memoryPort: e.target.value }))}
              placeholder="8788"
              inputMode="numeric"
              spellCheck={false}
              disabled={devDisabled}
            />
          </label>
        </div>

      </div>

      <div className="devNoteText muted">
        Memory facts are stored as JSON in <code>.eclia/memory/profile.json</code> and injected into the system prompt.
      </div>
    </>
  );
}
