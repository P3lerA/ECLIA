import React from "react";

import { SettingDisclosure } from "../../settings/components/SettingDisclosure";
import { updateMemory } from "../memoryApi";
import type { MemoryManageItem } from "../memoryTypes";
import { formatTs, memoryTitle } from "../memoryUtils";

export type MemoryItemDisclosureProps = {
  item: MemoryManageItem;
  onChange: (next: MemoryManageItem) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
};

export function MemoryItemDisclosure(props: MemoryItemDisclosureProps) {
  const { item, onChange, onDelete, disabled } = props;
  const [raw, setRaw] = React.useState(item.raw);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRaw(item.raw);
  }, [item.id, item.raw]);

  const dirty = raw.trim() !== item.raw.trim();
  const valid = raw.trim().length > 0;

  const save = async () => {
    if (!dirty || !valid || saving) return;

    setSaving(true);
    setErr(null);

    const updated = await updateMemory({ id: item.id, raw: raw.trim() });
    if (!updated) {
      setErr("Failed to update memory (memory service unreachable).");
    } else {
      onChange(updated);
    }

    setSaving(false);
  };

  const reset = () => {
    if (saving) return;
    setRaw(item.raw);
    setErr(null);
  };

  const del = () => {
    if (saving) return;
    const ok = window.confirm("Delete this memory item?");
    if (!ok) return;
    onDelete(item.id);
  };

  return (
    <SettingDisclosure
      title={memoryTitle(item.raw)}
      right={
        <button
          type="button"
          className="btn subtle"
          style={{ color: "var(--danger)" }}
          onClick={del}
          disabled={disabled || saving}
        >
          Delete
        </button>
      }
    >
      {err ? (
        <div className="devNoteText" style={{ color: "var(--danger)", marginBottom: 8 }}>
          {err}
        </div>
      ) : null}

      <div className="grid2 stack-gap">
        <label className="field">
          <div className="field-label">Created</div>
          <input className="select" value={formatTs(item.createdAt)} readOnly disabled />
        </label>

        <label className="field">
          <div className="field-label">Updated</div>
          <input className="select" value={formatTs(item.updatedAt)} readOnly disabled />
        </label>
      </div>

      <label className="field" style={{ marginTop: 10 }}>
        <div className="field-label">Fact</div>
        <textarea
          className="select"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={4}
          spellCheck={false}
          disabled={disabled || saving}
        />
      </label>

      <div className="profileActions" style={{ marginTop: 10, gap: 8 }}>
        <button type="button" className="btn subtle" onClick={reset} disabled={!dirty || saving}>
          Reset
        </button>
        <button type="button" className="btn subtle" onClick={save} disabled={!dirty || !valid || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </SettingDisclosure>
  );
}
