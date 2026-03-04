import React from "react";

import { SettingDisclosure } from "../../settings/components/SettingDisclosure";
import { updateMemory } from "../memoryApi";
import type { MemoryManageItem } from "../memoryTypes";
import { formatTs, memoryTitle, parseStrength } from "../memoryUtils";

export type MemoryItemDisclosureProps = {
  item: MemoryManageItem;
  onChange: (next: MemoryManageItem) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
};

export function MemoryItemDisclosure(props: MemoryItemDisclosureProps) {
  const { item, onChange, onDelete, disabled } = props;
  const [raw, setRaw] = React.useState(item.raw);
  const [strength, setStrength] = React.useState(String(item.strength));
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRaw(item.raw);
    setStrength(String(item.strength));
  }, [item.id, item.raw, item.strength]);

  const dirty = raw.trim() !== item.raw.trim() || parseStrength(strength) !== item.strength;
  const strengthNum = parseStrength(strength);
  const valid = raw.trim().length > 0 && strengthNum !== null;

  const save = async () => {
    if (!dirty || !valid || saving) return;

    setSaving(true);
    setErr(null);

    const updated = await updateMemory({ id: item.id, raw: raw.trim(), strength: strengthNum ?? item.strength });
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
    setStrength(String(item.strength));
    setErr(null);
  };

  const del = () => {
    if (saving) return;

    const ok = window.confirm("Delete this memory item? This cannot be undone (until persistence is implemented).");
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
          <div className="field-label">Strength (‖r‖)</div>
          <input
            className="select"
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
            inputMode="decimal"
            spellCheck={false}
            disabled={disabled || saving}
          />
        </label>
      </div>

      <div className="field-sub" style={{ marginTop: 6 }}>
        <b>Activations:</b> {item.activationCount} · <b>Last activated:</b> {formatTs(item.lastActivatedAt)} · <b>Origin:</b> {item.originSession || "—"}
      </div>

      <label className="field" style={{ marginTop: 10 }}>
        <div className="field-label">Raw</div>
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
