import React from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../motion/usePresence";
import type { ModelRouteOption } from "../settings/settingsUtils";
import type { PresetInfo, KindSchema, ConfigFieldSchema } from "../../core/api/symphony";
import { InstrumentForm, buildDefaultFormValue, buildPresetFormValue, getExtraPresetSchema, type InstrumentFormValue } from "./InstrumentForm";

export function NewInstrumentModal(props: {
  open: boolean;
  presets: PresetInfo[];
  triggerSchemas: KindSchema[];
  actionSchemas: KindSchema[];
  modelRouteOptions: ModelRouteOption[];
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { open, presets, triggerSchemas, actionSchemas, modelRouteOptions, onClose, onCreate } = props;
  const { present, motion } = usePresence(open, { exitMs: 220 });

  const [presetId, setPresetId] = React.useState("");
  const [instrumentId, setInstrumentId] = React.useState("");
  const [form, setForm] = React.useState<InstrumentFormValue>(() =>
    buildDefaultFormValue(triggerSchemas, actionSchemas)
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const preset = presets.find((p) => p.presetId === presetId);

  const extraActionSchema = React.useMemo<ConfigFieldSchema[]>(() => {
    if (!preset?.configSchema?.length) return [];
    return getExtraPresetSchema(
      preset.configSchema,
      form.triggers.map((t) => t.kind),
      form.actions.map((a) => a.kind),
      triggerSchemas,
      actionSchemas
    );
  }, [preset, form.triggers, form.actions, triggerSchemas, actionSchemas]);

  // ── Reset on open ──
  React.useEffect(() => {
    if (!open) return;
    const first = presets[0];
    if (first) {
      setPresetId(first.presetId);
      setForm(buildPresetFormValue(first, triggerSchemas, actionSchemas));
    } else {
      setPresetId("");
      setForm(buildDefaultFormValue(triggerSchemas, actionSchemas));
    }
    setInstrumentId("");
    setSaving(false);
    setError(null);
  }, [open, presets, triggerSchemas, actionSchemas]);

  const handlePresetChange = (id: string) => {
    setPresetId(id);
    const pr = presets.find((p) => p.presetId === id);
    if (pr) {
      setForm(buildPresetFormValue(pr, triggerSchemas, actionSchemas));
    }
  };

  const handleFormChange = (next: InstrumentFormValue) => {
    setForm(next);
    // Clear preset if kinds diverge.
    if (preset) {
      const matchesTrigger =
        next.triggers.length === preset.triggerKinds.length &&
        next.triggers.every((t, i) => t.kind === preset.triggerKinds[i]);
      const matchesActions =
        next.actions.length === preset.actionKinds.length &&
        next.actions.every((a, i) => a.kind === preset.actionKinds[i]);
      if (!matchesTrigger || !matchesActions) setPresetId("");
    }
  };

  // ── Escape ──
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!present) return null;

  const handleSubmit = async () => {
    const id = instrumentId.trim();
    if (!id) { setError("Instrument ID is required."); return; }
    if (form.triggers.length === 0 || !form.triggers[0].kind) { setError("At least one trigger is required."); return; }
    if (form.actions.length === 0 || !form.actions[0].kind) { setError("At least one action is required."); return; }

    const payload: Record<string, unknown> = {
      instrumentId: id,
      name: id,
      triggers: form.triggers,
      actions: form.actions
    };

    setSaving(true);
    setError(null);
    try {
      await onCreate(payload);
      onClose();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="instrumentModal-backdrop motion-overlay"
      data-motion={motion}
      role="dialog"
      aria-modal="true"
      aria-label="New instrument"
      onMouseDown={onClose}
    >
      <div
        className="instrumentModal motion-sheet"
        data-motion={motion}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="instrumentModal-head">
          <span className="instrumentModal-title">New Instrument</span>
          <div className="instrumentModal-headActions">
            <button className="btn subtle" onClick={onClose} type="button">Cancel</button>
            <button className="btn" onClick={handleSubmit} disabled={saving} type="button">
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </div>

        <div className="instrumentModal-body">
          {/* Preset selector */}
          {presets.length > 0 && (
            <label className="field">
              <span className="field-label">Preset</span>
              <select className="select" value={presetId} onChange={(e) => handlePresetChange(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.presetId} value={p.presetId}>{p.name}</option>
                ))}
                <option value="">Custom…</option>
              </select>
            </label>
          )}

          {preset?.description && (
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{preset.description}</div>
          )}

          {/* Instrument ID */}
          <label className="field">
            <span className="field-label">Instrument ID</span>
            <input
              className="select"
              type="text"
              value={instrumentId}
              onChange={(e) => setInstrumentId(e.target.value)}
              placeholder="e.g. email_work"
            />
          </label>

          {/* Trigger + Actions form */}
          <InstrumentForm
            value={form}
            onChange={handleFormChange}
            triggerSchemas={triggerSchemas}
            actionSchemas={actionSchemas}
            modelRouteOptions={modelRouteOptions}
            extraActionSchema={presetId ? extraActionSchema : undefined}
          />

          {error && <div className="form-error">{error}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}
