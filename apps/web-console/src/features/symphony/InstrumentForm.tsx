import React from "react";
import type { ModelRouteOption } from "../settings/settingsUtils";
import type { KindSchema, ConfigFieldSchema } from "../../core/api/symphony";
import { SchemaFields, seedDefaults } from "./SchemaFields";

export interface InstrumentFormValue {
  triggers: Array<{ kind: string; config: Record<string, unknown> }>;
  actions: Array<{ kind: string; config: Record<string, unknown> }>;
}

export function InstrumentForm(props: {
  value: InstrumentFormValue;
  onChange: (value: InstrumentFormValue) => void;
  triggerSchemas: KindSchema[];
  actionSchemas: KindSchema[];
  modelRouteOptions: ModelRouteOption[];
  /** Extra fields appended inside the last action card; values read/write from the action's config. */
  extraActionSchema?: ConfigFieldSchema[];
}) {
  const { value, onChange, triggerSchemas, actionSchemas, modelRouteOptions,
    extraActionSchema } = props;

  // ── Trigger helpers ──

  const setTriggerKind = (index: number, kind: string) => {
    const schema = triggerSchemas.find((s) => s.kind === kind);
    const next = [...value.triggers];
    next[index] = { kind, config: schema ? seedDefaults(schema.configSchema) : {} };
    onChange({ ...value, triggers: next });
  };

  const setTriggerConfig = (index: number, updater: React.SetStateAction<Record<string, unknown>>) => {
    const next = [...value.triggers];
    next[index] = {
      ...next[index],
      config: typeof updater === "function" ? updater(next[index].config) : updater
    };
    onChange({ ...value, triggers: next });
  };

  const addTrigger = () => {
    const kind = triggerSchemas[0]?.kind ?? "";
    const schema = triggerSchemas.find((s) => s.kind === kind);
    onChange({
      ...value,
      triggers: [...value.triggers, { kind, config: schema ? seedDefaults(schema.configSchema) : {} }]
    });
  };

  const removeTrigger = (index: number) => {
    onChange({ ...value, triggers: value.triggers.filter((_, i) => i !== index) });
  };

  // ── Action helpers ──

  const setActionKind = (index: number, kind: string) => {
    const schema = actionSchemas.find((s) => s.kind === kind);
    const next = [...value.actions];
    next[index] = { kind, config: schema ? seedDefaults(schema.configSchema) : {} };
    onChange({ ...value, actions: next });
  };

  const setActionConfig = (index: number, updater: React.SetStateAction<Record<string, unknown>>) => {
    const next = [...value.actions];
    next[index] = {
      ...next[index],
      config: typeof updater === "function" ? updater(next[index].config) : updater
    };
    onChange({ ...value, actions: next });
  };

  const addAction = () => {
    const kind = actionSchemas[0]?.kind ?? "";
    const schema = actionSchemas.find((s) => s.kind === kind);
    onChange({
      ...value,
      actions: [...value.actions, { kind, config: schema ? seedDefaults(schema.configSchema) : {} }]
    });
  };

  const removeAction = (index: number) => {
    onChange({ ...value, actions: value.actions.filter((_, i) => i !== index) });
  };

  return (
    <div className="instrumentModal-columns">
      {/* Triggers */}
      <div className="instrumentModal-col">
        <div className="instrumentModal-colHeader">
          <div className="instrumentModal-colTitle">Triggers</div>
          <button className="instrumentForm-addInline" onClick={addTrigger} type="button" aria-label="Add trigger">+</button>
        </div>
        {value.triggers.map((trigger, i) => {
          const schema = triggerSchemas.find((s) => s.kind === trigger.kind);
          return (
            <div key={i} className="instrumentForm-card">
              <div className="instrumentForm-cardHead">
                <span className="instrumentForm-cardLabel">
                  {value.triggers.length > 1 && <span className="instrumentModal-stepNum">{i + 1}</span>}
                  Trigger
                </span>
                {value.triggers.length > 1 && (
                  <button
                    className="btn subtle instrumentForm-removeBtn"
                    onClick={() => removeTrigger(i)}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
              <label className="field">
                <span className="field-label">Kind</span>
                <select className="select" value={trigger.kind} onChange={(e) => setTriggerKind(i, e.target.value)}>
                  {triggerSchemas.map((s) => (
                    <option key={s.kind} value={s.kind}>{s.label}</option>
                  ))}
                </select>
              </label>
              {schema && schema.configSchema.length > 0 && (
                <SchemaFields
                  schema={schema.configSchema}
                  values={trigger.config}
                  onChange={(updater) => setTriggerConfig(i, updater)}
                  modelRouteOptions={modelRouteOptions}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="instrumentModal-col">
        <div className="instrumentModal-colHeader">
          <div className="instrumentModal-colTitle">Actions</div>
          <button className="instrumentForm-addInline" onClick={addAction} type="button" aria-label="Add action">+</button>
        </div>
        {value.actions.map((action, i) => {
          const schema = actionSchemas.find((s) => s.kind === action.kind);
          const isLast = i === value.actions.length - 1;
          return (
            <div key={i} className="instrumentForm-card">
              <div className="instrumentForm-cardHead">
                <span className="instrumentForm-cardLabel">
                  {value.actions.length > 1 && <span className="instrumentModal-stepNum">{i + 1}</span>}
                  Action
                </span>
                {value.actions.length > 1 && (
                  <button
                    className="btn subtle instrumentForm-removeBtn"
                    onClick={() => removeAction(i)}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
              <label className="field">
                <span className="field-label">Kind</span>
                <select className="select" value={action.kind} onChange={(e) => setActionKind(i, e.target.value)}>
                  {actionSchemas.map((s) => (
                    <option key={s.kind} value={s.kind}>{s.label}</option>
                  ))}
                </select>
              </label>
              {schema && schema.configSchema.length > 0 && (
                <SchemaFields
                  schema={schema.configSchema}
                  values={action.config}
                  onChange={(updater) => setActionConfig(i, updater)}
                  modelRouteOptions={modelRouteOptions}
                />
              )}
              {isLast && extraActionSchema && extraActionSchema.length > 0 && (
                <SchemaFields
                  schema={extraActionSchema}
                  values={action.config}
                  onChange={(updater) => setActionConfig(i, updater)}
                  modelRouteOptions={modelRouteOptions}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function buildDefaultFormValue(
  triggerSchemas: KindSchema[],
  actionSchemas: KindSchema[]
): InstrumentFormValue {
  const triggerKind = triggerSchemas[0]?.kind ?? "";
  const actionKind = actionSchemas[0]?.kind ?? "";
  const trSchema = triggerSchemas.find((s) => s.kind === triggerKind);
  const acSchema = actionSchemas.find((s) => s.kind === actionKind);
  return {
    triggers: [{ kind: triggerKind, config: trSchema ? seedDefaults(trSchema.configSchema) : {} }],
    actions: [{ kind: actionKind, config: acSchema ? seedDefaults(acSchema.configSchema) : {} }]
  };
}

export function buildPresetFormValue(
  preset: { triggerKinds: string[]; actionKinds: string[]; configSchema?: ConfigFieldSchema[] },
  triggerSchemas: KindSchema[],
  actionSchemas: KindSchema[]
): InstrumentFormValue {
  const triggers = preset.triggerKinds.map((kind) => {
    const schema = triggerSchemas.find((s) => s.kind === kind);
    return { kind, config: schema ? seedDefaults(schema.configSchema) : {} };
  });
  const actions = preset.actionKinds.map((kind) => {
    const schema = actionSchemas.find((s) => s.kind === kind);
    return { kind, config: schema ? seedDefaults(schema.configSchema) : {} };
  });

  // Seed extra preset fields (not covered by trigger/action schemas) into last action config.
  if (actions.length > 0 && preset.configSchema?.length) {
    const knownKeys = new Set([
      ...triggers.flatMap((t) => {
        const s = triggerSchemas.find((s) => s.kind === t.kind);
        return s?.configSchema.map((f) => f.key) ?? [];
      }),
      ...actions.flatMap((a) => {
        const s = actionSchemas.find((s) => s.kind === a.kind);
        return s?.configSchema.map((f) => f.key) ?? [];
      })
    ]);
    const extras = preset.configSchema.filter((f) => !knownKeys.has(f.key));
    if (extras.length) {
      const last = actions[actions.length - 1];
      last.config = { ...last.config, ...seedDefaults(extras) };
    }
  }

  return { triggers, actions };
}
