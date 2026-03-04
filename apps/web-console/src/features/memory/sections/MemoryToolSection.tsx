import React from "react";

import type { MemoryBase, MemoryDraft } from "../memoryTypes";

export type MemoryToolSectionProps = {
  base: MemoryBase | null;
  draft: MemoryDraft;
  setDraft: React.Dispatch<React.SetStateAction<MemoryDraft>>;
  devDisabled: boolean;
};

export function MemoryToolSection(props: MemoryToolSectionProps) {
  const { base, draft, setDraft, devDisabled } = props;

  return (
    <>
      {!base ? (
        <div className="devNoteText muted">
          Config service unavailable. Start the backend (pnpm dev:all) to edit memory tool settings.
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">Tool output truncation</div>

        <div className="grid2">
          <label className="field">
            <div className="field-label">Tool messages</div>
            <select
              className="select"
              value={draft.extractToolMessages}
              onChange={(e) => {
                const v = e.target.value === "truncate" ? "truncate" : "drop";
                setDraft((d) => ({ ...d, extractToolMessages: v }));
              }}
              disabled={devDisabled}
            >
              <option value="drop">Drop (recommended)</option>
              <option value="truncate">Truncate and keep</option>
            </select>
            <div className="field-sub">
              Controls how role=tool messages are handled when the memory service sends a role-structured transcript to the extraction model.
            </div>
          </label>

          <div className="field" aria-hidden="true" />
        </div>

        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="field">
            <div className="field-label">Max chars per tool message</div>
            <input
              className="select"
              value={draft.extractToolMaxCharsPerMsg}
              onChange={(e) => setDraft((d) => ({ ...d, extractToolMaxCharsPerMsg: e.target.value }))}
              placeholder="1200"
              inputMode="numeric"
              spellCheck={false}
              disabled={devDisabled || draft.extractToolMessages === "drop"}
            />
            <div className="field-sub">Only used when Tool messages = Truncate and keep.</div>
          </label>

          <label className="field">
            <div className="field-label">Max total tool chars</div>
            <input
              className="select"
              value={draft.extractToolMaxTotalChars}
              onChange={(e) => setDraft((d) => ({ ...d, extractToolMaxTotalChars: e.target.value }))}
              placeholder="5000"
              inputMode="numeric"
              spellCheck={false}
              disabled={devDisabled || draft.extractToolMessages === "drop"}
            />
            <div className="field-sub">Hard cap for all tool text kept in the transcript tail.</div>
          </label>
        </div>
      </div>

      <div className="devNoteText muted">
        Tip: edit <code>_system_memory_extract.local.md</code> to control the extraction model's system prompt.
      </div>
    </>
  );
}
