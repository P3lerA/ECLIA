import React from "react";

/**
 * Reusable save / discard action bar used in view headers.
 *
 * Shows an "Unsaved changes" indicator when dirty, plus Discard and Save buttons.
 * Callers can append extra elements (e.g. ThemeModeSwitch) via `children`.
 */
export function SaveDiscardBar(props: {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  children?: React.ReactNode;
}) {
  const { dirty, saving, canSave, onSave, onDiscard, saveLabel = "Save", children } = props;

  return (
    <>
      {dirty && (
        <div className="saveIndicator" role="status" aria-live="polite">
          <span className="saveDot" aria-hidden="true" />
          Unsaved changes
        </div>
      )}

      <button className="btn subtle btn-discard" onClick={onDiscard} disabled={!dirty || saving} aria-label="Discard changes">
        Discard
      </button>

      <button className="btn subtle btn-save" onClick={onSave} disabled={!canSave} aria-label={saveLabel}>
        {saving ? "Saving…" : saveLabel}
      </button>

      {children}
    </>
  );
}
