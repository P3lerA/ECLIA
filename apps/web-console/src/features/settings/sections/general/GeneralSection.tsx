import React from "react";
import type { SettingsDraft } from "../../settingsTypes";
import { Collapsible } from "../../../common/Collapsible";

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

  return (
    <>
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
              disabled={devDisabled}
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
              disabled={devDisabled}
            />
          </label>
        </div>

        <div className="row stack-gap">
          <div className="row-left">
            <div className="row-main">Session Sync</div>
            <div className="row-sub muted">Best-effort hydration of sessions/messages from the local gateway.</div>
          </div>

          <input
            type="checkbox"
            checked={draft.sessionSyncEnabled}
            onChange={(e) => setDraft((d) => ({ ...d, sessionSyncEnabled: e.target.checked }))}
            aria-label="Enable session sync"
          />
        </div>

        <div className="row stack-gap">
          <div className="row-left">
            <div className="row-main">Display Plain Output</div>
            <div className="row-sub muted">
              Show full raw tool payloads (tool_call/tool_result) and show &lt;think&gt; blocks inline.
            </div>
          </div>

          <input
            type="checkbox"
            checked={draft.displayPlainOutput}
            onChange={(e) => setDraft((d) => ({ ...d, displayPlainOutput: e.target.checked }))}
            aria-label="Display plain output"
          />
        </div>

        {cfgError ? <div className="devNoteText muted">{cfgError}</div> : null}

        {dirtyDevHostPort && !hostPortValid ? (
          <div className="devNoteText muted">Invalid host or port. Port must be 1–65535.</div>
        ) : null}

        {cfgSaved ? <div className="devNoteText muted">{cfgSaved}</div> : null}
      </div>

      <Collapsible title="Advanced" variant="section">
        <div className="row stack-gap">
          <div className="row-left">
            <div className="row-main">Capture Upstream Requests</div>
            <div className="row-sub muted">
              Save the full upstream request body to <code>.eclia/debug/&lt;sessionId&gt;/</code> for debugging.
            </div>
          </div>

          <input
            type="checkbox"
            checked={draft.debugCaptureUpstreamRequests}
            onChange={(e) => setDraft((d) => ({ ...d, debugCaptureUpstreamRequests: e.target.checked }))}
            aria-label="Capture upstream requests"
            disabled={devDisabled}
          />
        </div>

        <div className="row stack-gap">
          <div className="row-left">
            <div className="row-main">Parse Assistant Output</div>
            <div className="row-sub muted">
              Attempt to recover tool calls from assistant plaintext output when the provider fails to emit structured tool calls.
              Writes warnings to <code>.eclia/debug/&lt;sessionId&gt;/warnings.ndjson</code> and shows a warning in approval prompts.
            </div>
          </div>

          <input
            type="checkbox"
            checked={draft.debugParseAssistantOutput}
            onChange={(e) => setDraft((d) => ({ ...d, debugParseAssistantOutput: e.target.checked }))}
            aria-label="Parse assistant output"
            disabled={devDisabled}
          />
        </div>
      </Collapsible>
    </>
  );
}
