import React from "react";
import { EcliaLogo } from "../common/EcliaLogo";
import { SaveDiscardBar } from "../common/SaveDiscardBar";
import { fetchDevConfig } from "../settings/settingsInteractions";
import { buildModelRouteOptions, type ModelRouteOption } from "../settings/settingsUtils";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { InstrumentCard } from "./InstrumentCard";
import { InstrumentDetailModal } from "./InstrumentDetailModal";
import { NewInstrumentModal } from "./NewInstrumentModal";
import {
  apiListInstruments,
  apiSetInstrumentEnabled,
  apiDeleteInstrument,
  apiCreateInstrument,
  apiListPresets,
  apiListTriggers,
  apiListActions,
  type InstrumentDetail,
  type PresetInfo,
  type KindSchema
} from "../../core/api/symphony";

export function SymphonyView({ onBack }: { onBack: () => void }) {
  const [instruments, setInstruments] = React.useState<InstrumentDetail[]>([]);
  const [presets, setPresets] = React.useState<PresetInfo[]>([]);
  const [triggerSchemas, setTriggerSchemas] = React.useState<KindSchema[]>([]);
  const [actionSchemas, setActionSchemas] = React.useState<KindSchema[]>([]);
  const [modelRouteOptions, setModelRouteOptions] = React.useState<ModelRouteOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showNew, setShowNew] = React.useState(false);

  const [selected, setSelected] = React.useState<InstrumentDetail | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  // ── Draft overrides (map of id → draftEnabled) ────────
  // Only contains entries that differ from the instrument's current enabled.
  const [overrides, setOverrides] = React.useState<Map<string, boolean>>(new Map());
  const [saving, setSaving] = React.useState(false);

  const dirty = overrides.size > 0;
  const canSave = dirty && !saving;

  const toggleDraft = (id: string, currentEnabled: boolean) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const draft = next.has(id) ? next.get(id)! : currentEnabled;
      const flipped = !draft;
      if (flipped === currentEnabled) next.delete(id);
      else next.set(id, flipped);
      return next;
    });
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await Promise.all(
        [...overrides.entries()].map(([id, enabled]) => apiSetInstrumentEnabled(id, enabled))
      );
      setInstruments((prev) =>
        prev.map((inst) => {
          const ov = overrides.get(inst.id);
          return ov !== undefined ? { ...inst, enabled: ov } : inst;
        })
      );
      setOverrides(new Map());
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setOverrides(new Map());
  };

  const back = () => {
    if (dirty || saving) return;
    onBack();
  };

  // ── Fetch ────────────────────────────────────────────────

  const fetchAll = React.useCallback(async () => {
    try {
      const [insts, prs, trigs, acts, cfgRes] = await Promise.all([
        apiListInstruments(), apiListPresets(), apiListTriggers(), apiListActions(),
        fetchDevConfig()
      ]);
      setInstruments(insts);
      setPresets(prs);
      setTriggerSchemas(trigs);
      setActionSchemas(acts);

      if (cfgRes.ok) {
        const cfg = cfgRes.config;
        const norm = (ps?: Array<{ id: string; name?: string }>) =>
          ps?.map((p) => ({ id: p.id, name: p.name ?? p.id })) ?? null;
        setModelRouteOptions(buildModelRouteOptions(
          norm(cfg.inference?.openai_compat?.profiles),
          norm(cfg.inference?.anthropic?.profiles),
          norm(cfg.inference?.codex_oauth?.profiles)
        ));
      }

      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Delete ───────────────────────────────────────────────

  const handleDelete = React.useCallback(
    async (id: string) => {
      setSelected(null);
      setModalOpen(false);
      setOverrides((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setInstruments((prev) => prev.filter((inst) => inst.id !== id));

      try {
        await apiDeleteInstrument(id);
      } catch {
        fetchAll();
      }
    },
    [fetchAll]
  );

  // ── Create ───────────────────────────────────────────────

  const handleCreate = React.useCallback(
    async (payload: Record<string, unknown>) => {
      const inst = await apiCreateInstrument(payload);
      setInstruments((prev) => [...prev, inst]);
    },
    []
  );

  // ── Render ───────────────────────────────────────────────

  const selectedEnabled = selected
    ? (overrides.has(selected.id) ? overrides.get(selected.id)! : selected.enabled)
    : false;

  return (
    <div className="symphonyview motion-page">
      {/* Head */}
      <div className="settings-head">
        <button className="btn icon" onClick={back} type="button" aria-label="Back" disabled={dirty || saving}>
          ←
        </button>
        <div className="settings-head-title">
          <EcliaLogo size="md" onClick={back} disabled={dirty || saving} />
          <span className="settings-title">Symphony</span>
        </div>
        <div className="settings-head-actions">
          <SaveDiscardBar dirty={dirty} saving={saving} canSave={canSave} onSave={save} onDiscard={discard}>
            {presets.length > 0 && (
              <button className="btn subtle" onClick={() => setShowNew(true)} type="button">
                + New
              </button>
            )}
            <ThemeModeSwitch compact />
          </SaveDiscardBar>
        </div>
      </div>

      {/* Body */}
      <div className="symphony-body">
        {loading && (
          <div className="symphony-empty muted">Loading instruments...</div>
        )}

        {!loading && error && (
          <div className="symphony-empty">
            <span className="muted">Failed to load instruments</span>
            <span className="muted" style={{ fontSize: 12 }}>{error}</span>
            <button className="btn subtle" onClick={fetchAll} type="button">Retry</button>
          </div>
        )}

        {!loading && !error && instruments.length === 0 && (
          <div className="symphony-empty">
            <span className="muted">No instruments configured.</span>
            {presets.length > 0 && (
              <button className="btn subtle" onClick={() => setShowNew(true)} type="button">
                + Create one
              </button>
            )}
          </div>
        )}

        {!loading && !error && instruments.length > 0 && (
          <div className="symphony-grid">
            {instruments.map((inst) => (
              <InstrumentCard
                key={inst.id}
                data={inst}
                onClick={() => { setSelected(inst); setModalOpen(true); }}
              />
            ))}
          </div>
        )}
      </div>

      <InstrumentDetailModal
        instrument={modalOpen ? selected : null}
        onClose={() => setModalOpen(false)}
        draftEnabled={selectedEnabled}
        onToggleDraft={() => { if (selected) toggleDraft(selected.id, selected.enabled); }}
        onDelete={handleDelete}
        onUpdate={(updated) => {
          setInstruments((prev) => prev.map((inst) => inst.id === updated.id ? updated : inst));
          setSelected(updated);
        }}
        triggerSchemas={triggerSchemas}
        actionSchemas={actionSchemas}
        modelRouteOptions={modelRouteOptions}
      />

      <NewInstrumentModal
        open={showNew}
        presets={presets}
        triggerSchemas={triggerSchemas}
        actionSchemas={actionSchemas}
        modelRouteOptions={modelRouteOptions}
        onClose={() => setShowNew(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
