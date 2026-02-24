import React from "react";
import type { SettingsDraft } from "../../settingsTypes";
import { Modal } from "../../../common/Modal";
import { SettingsAdvancedSection } from "../../components/SettingsAdvancedSection";
import { SettingsToggleRow } from "../../components/SettingsToggleRow";

export type GeneralSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  cfgLoading: boolean;
  cfgBaseAvailable: boolean;
  cfgError: string | null;
  cfgSaved: string | null;

  dirtyDevHostPort: boolean;
  hostPortValid: boolean;
};

export function GeneralSection(props: GeneralSectionProps) {
  const { draft, setDraft, cfgLoading, cfgBaseAvailable, cfgError, cfgSaved, dirtyDevHostPort, hostPortValid } = props;

  const devDisabled = cfgLoading || !cfgBaseAvailable;
  const [exposeWarnOpen, setExposeWarnOpen] = React.useState(false);

  const consoleHostValue = draft.consoleHost.trim() === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";

  const onHostChange = (nextHost: string) => {
    if (devDisabled) return;

    const next = nextHost.trim();
    if (next === "0.0.0.0" && consoleHostValue !== "0.0.0.0") {
      setExposeWarnOpen(true);
      return;
    }

    setDraft((d) => ({ ...d, consoleHost: next }));
  };

  return (
    <>
      <div className="card">
        <div className="card-title">Development</div>

        <div className="grid2">
          <label className="field">
            <div className="field-label">Console host</div>
            <select
              className="select"
              value={consoleHostValue}
              onChange={(e) => onHostChange(e.target.value)}
              disabled={devDisabled}
            >
              <option value="127.0.0.1">127.0.0.1 (local only)</option>
              <option value="0.0.0.0">0.0.0.0 (all interfaces)</option>
            </select>
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
              disabled={devDisabled}
            />
          </label>
        </div>

        <SettingsToggleRow
          className="stack-gap"
          title="Session Sync"
          description="Best-effort hydration of sessions/messages from the local gateway."
          checked={draft.sessionSyncEnabled}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, sessionSyncEnabled: checked }))}
          ariaLabel="Enable session sync"
        />

        <SettingsToggleRow
          className="stack-gap"
          title="Display Plain Output"
          description="Show full raw tool payloads (tool_call/tool_result) and show <think> blocks inline."
          checked={draft.displayPlainOutput}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, displayPlainOutput: checked }))}
          ariaLabel="Display plain output"
        />

        {cfgError ? <div className="devNoteText muted">{cfgError}</div> : null}

        {dirtyDevHostPort && !hostPortValid ? (
          <div className="devNoteText muted">Invalid host or port. Port must be 1–65535.</div>
        ) : null}

        {cfgSaved ? <div className="devNoteText muted">{cfgSaved}</div> : null}
      </div>

      {exposeWarnOpen ? (
        <Modal open={exposeWarnOpen} onClose={() => setExposeWarnOpen(false)} ariaLabel="Expose Web Console warning">
          <div className="card-title">Expose Web Console to the network?</div>
          <div className="modal-body muted">
            Setting <code>console.host</code> to <code>0.0.0.0</code> makes the Web Console listen on all network
            interfaces. Anyone who can reach your machine on the configured port can attempt to access it.
          </div>

          <div className="modal-actions">
            <button className="btn subtle" type="button" onClick={() => setExposeWarnOpen(false)}>
              Cancel
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setDraft((d) => ({ ...d, consoleHost: "0.0.0.0" }));
                setExposeWarnOpen(false);
              }}
            >
              I know what I&apos;m doing!
            </button>
          </div>
        </Modal>
      ) : null}

      <SettingsAdvancedSection>
        <SettingsToggleRow
          className="stack-gap"
          title="Capture Upstream Requests"
          description={
            <>
              Save the full upstream request body to <code>.eclia/debug/&lt;sessionId&gt;/</code> for debugging.
            </>
          }
          checked={draft.debugCaptureUpstreamRequests}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, debugCaptureUpstreamRequests: checked }))}
          ariaLabel="Capture upstream requests"
          disabled={devDisabled}
        />

        <SettingsToggleRow
          className="stack-gap"
          title="Parse Assistant Output"
          description={
            <>
              Attempt to recover tool calls from assistant plaintext output when the provider fails to emit structured
              tool calls. Writes warnings to <code>.eclia/debug/&lt;sessionId&gt;/warnings.ndjson</code> and shows a
              warning in approval prompts.
            </>
          }
          checked={draft.debugParseAssistantOutput}
          onCheckedChange={(checked) => setDraft((d) => ({ ...d, debugParseAssistantOutput: checked }))}
          ariaLabel="Parse assistant output"
          disabled={devDisabled}
        />
      </SettingsAdvancedSection>
    </>
  );
}
