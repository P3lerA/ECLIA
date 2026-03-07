import React from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../motion/usePresence";
import type { ModelRouteOption } from "../settings/settingsUtils";
import { apiUpdateInstrument, type InstrumentDetail, type KindSchema } from "../../core/api/symphony";
import { InstrumentForm, type InstrumentFormValue } from "./InstrumentForm";

export function InstrumentDetailModal(props: {
  instrument: InstrumentDetail | null;
  onClose: () => void;
  draftEnabled: boolean;
  onToggleDraft: () => void;
  onDelete?: (id: string) => void;
  onUpdate?: (updated: InstrumentDetail) => void;
  triggerSchemas: KindSchema[];
  actionSchemas: KindSchema[];
  modelRouteOptions: ModelRouteOption[];
}) {
  const {
    instrument, onClose, draftEnabled, onToggleDraft, onDelete, onUpdate,
    triggerSchemas, actionSchemas, modelRouteOptions
  } = props;
  const open = instrument !== null;

  const { present, motion } = usePresence(open, { exitMs: 220 });

  const [editing, setEditing] = React.useState(false);
  const [formValue, setFormValue] = React.useState<InstrumentFormValue>({
    triggers: [],
    actions: []
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const startEdit = () => {
    if (!instrument) return;
    setFormValue({
      triggers: instrument.triggers.map((t) => ({ kind: t.kind, config: { ...t.config } })),
      actions: instrument.actions.map((a) => ({ kind: a.kind, config: { ...a.config } }))
    });
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const saveEdit = async () => {
    if (!instrument) return;
    if (formValue.triggers.length === 0 || !formValue.triggers[0].kind) { setError("At least one trigger is required."); return; }
    if (formValue.actions.length === 0 || !formValue.actions[0].kind) {
      setError("At least one action is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await apiUpdateInstrument(instrument.id, {
        triggers: formValue.triggers,
        actions: formValue.actions
      });
      onUpdate?.(updated);
      setEditing(false);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  // Reset edit state when modal closes.
  React.useEffect(() => {
    if (!open) { setEditing(false); setError(null); }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing) cancelEdit();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, editing, onClose]);

  // Freeze data for exit animation.
  const frozenRef = React.useRef<InstrumentDetail | null>(null);
  if (instrument) frozenRef.current = instrument;
  const data = instrument ?? frozenRef.current;

  if (!present || !data) return null;

  const handleDelete = () => {
    if (!window.confirm(`Delete instrument "${data.name}"?\n\nThis will stop and remove it.`)) return;
    onDelete?.(data.id);
    onClose();
  };

  return createPortal(
    <div
      className="instrumentModal-backdrop motion-overlay"
      data-motion={motion}
      role="dialog"
      aria-modal="true"
      aria-label={`Instrument: ${data.name}`}
      onMouseDown={() => { if (!editing) onClose(); }}
    >
      <div
        className="instrumentModal motion-sheet"
        data-motion={motion}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="instrumentModal-head">
          <div className="instrumentModal-headLeft">
            <span className="instrumentModal-title">{data.name}</span>
            <span className={`instrumentCard-status ${data.status}`} data-status={data.status}>
              <span className="instrumentCard-statusDot" />
              {data.status}
            </span>
          </div>
          <div className="instrumentModal-headActions">
            {editing ? (
              <>
                <button className="btn subtle" onClick={cancelEdit} disabled={saving} type="button">Cancel</button>
                <button className="btn" onClick={saveEdit} disabled={saving} type="button">
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <>
                <button className="btn subtle instrumentModal-deleteBtn" onClick={handleDelete} type="button">Delete</button>
                <button className="btn subtle" onClick={startEdit} type="button">Edit</button>
                <button className="btn subtle" onClick={onClose} type="button">Close</button>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="instrumentModal-body">
          {/* Enabled toggle */}
          <div className="instrumentModal-row">
            <label className="inlineToggle">
              <input
                type="checkbox"
                checked={draftEnabled}
                onChange={onToggleDraft}
                disabled={editing}
              />
              <span>Enabled</span>
            </label>
          </div>

          {editing ? (
            <>
              <InstrumentForm
                value={formValue}
                onChange={setFormValue}
                triggerSchemas={triggerSchemas}
                actionSchemas={actionSchemas}
                modelRouteOptions={modelRouteOptions}
              />
              {error && <div className="form-error">{error}</div>}
            </>
          ) : (
            <div className="instrumentModal-columns">
              <div className="instrumentModal-col">
                <div className="instrumentModal-colTitle">Triggers</div>
                {data.triggers.map((trigger, i) => {
                  const schema = triggerSchemas.find((s) => s.kind === trigger.kind);
                  return (
                    <div key={`t${i}`} className="instrumentForm-card">
                      <div className="instrumentForm-cardHead">
                        <span className="instrumentForm-cardLabel">
                          {data.triggers.length > 1 && <span className="instrumentModal-stepNum">{i + 1}</span>}
                          {schema?.label ?? trigger.kind}
                        </span>
                      </div>
                      <ConfigTable config={trigger.config} />
                    </div>
                  );
                })}
              </div>
              <div className="instrumentModal-col">
                <div className="instrumentModal-colTitle">Actions</div>
                {data.actions.map((action, i) => {
                  const schema = actionSchemas.find((s) => s.kind === action.kind);
                  return (
                    <div key={`a${i}`} className="instrumentForm-card">
                      <div className="instrumentForm-cardHead">
                        <span className="instrumentForm-cardLabel">
                          {data.actions.length > 1 && <span className="instrumentModal-stepNum">{i + 1}</span>}
                          {schema?.label ?? action.kind}
                        </span>
                      </div>
                      <ConfigTable config={action.config} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function ConfigTable({ config }: { config: Record<string, unknown> }) {
  const entries = Object.entries(config).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (!entries.length) return <div className="muted" style={{ fontSize: 12 }}>No configuration</div>;

  return (
    <div className="instrumentModal-configTable">
      {entries.map(([key, value]) => (
        <div key={key} className="instrumentModal-configRow">
          <span className="instrumentModal-configKey">{key}</span>
          <span className="instrumentModal-configVal">{formatValue(key, value)}</span>
        </div>
      ))}
    </div>
  );
}

function formatValue(key: string, v: unknown): string {
  if (typeof v === "string") {
    if (/pass|token|secret|key/i.test(key) && v.length > 0) {
      return v.slice(0, 3) + "***";
    }
    return v.length > 80 ? v.slice(0, 77) + "..." : v;
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}
