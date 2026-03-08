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

  function makeListHelpers(listKey: "triggers" | "actions", schemas: KindSchema[]) {
    const setKind = (index: number, kind: string) => {
      const schema = schemas.find((s) => s.kind === kind);
      const next = [...value[listKey]];
      next[index] = { kind, config: schema ? seedDefaults(schema.configSchema) : {} };
      onChange({ ...value, [listKey]: next });
    };

    const setConfig = (index: number, updater: React.SetStateAction<Record<string, unknown>>) => {
      const next = [...value[listKey]];
      next[index] = {
        ...next[index],
        config: typeof updater === "function" ? updater(next[index].config) : updater
      };
      onChange({ ...value, [listKey]: next });
    };

    const add = () => {
      const kind = schemas[0]?.kind ?? "";
      const schema = schemas.find((s) => s.kind === kind);
      onChange({
        ...value,
        [listKey]: [...value[listKey], { kind, config: schema ? seedDefaults(schema.configSchema) : {} }]
      });
    };

    const remove = (index: number) => {
      onChange({ ...value, [listKey]: value[listKey].filter((_, i) => i !== index) });
    };

    return { setKind, setConfig, add, remove };
  }

  const trig = makeListHelpers("triggers", triggerSchemas);
  const act = makeListHelpers("actions", actionSchemas);

  return (
    <div className="instrumentModal-columns">
      {/* Triggers */}
      <div className="instrumentModal-col">
        <div className="instrumentModal-colHeader">
          <div className="instrumentModal-colTitle">Triggers</div>
          <button className="instrumentForm-addInline" onClick={trig.add} type="button" aria-label="Add trigger">+</button>
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
                    onClick={() => trig.remove(i)}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
              <label className="field">
                <span className="field-label">Kind</span>
                <select className="select" value={trigger.kind} onChange={(e) => trig.setKind(i, e.target.value)}>
                  {triggerSchemas.map((s) => (
                    <option key={s.kind} value={s.kind}>{s.label}</option>
                  ))}
                </select>
              </label>
              {schema && schema.configSchema.length > 0 && (
                <SchemaFields
                  schema={schema.configSchema}
                  values={trigger.config}
                  onChange={(updater) => trig.setConfig(i, updater)}
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
          <button className="instrumentForm-addInline" onClick={act.add} type="button" aria-label="Add action">+</button>
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
                    onClick={() => act.remove(i)}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
              <label className="field">
                <span className="field-label">Kind</span>
                <select className="select" value={action.kind} onChange={(e) => act.setKind(i, e.target.value)}>
                  {actionSchemas.map((s) => (
                    <option key={s.kind} value={s.kind}>{s.label}</option>
                  ))}
                </select>
              </label>
              {schema && schema.configSchema.length > 0 && (
                <SchemaFields
                  schema={schema.configSchema}
                  values={action.config}
                  onChange={(updater) => act.setConfig(i, updater)}
                  modelRouteOptions={modelRouteOptions}
                />
              )}
              {isLast && extraActionSchema && extraActionSchema.length > 0 && (
                <SchemaFields
                  schema={extraActionSchema}
                  values={action.config}
                  onChange={(updater) => act.setConfig(i, updater)}
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

/**
 * Return preset configSchema fields not already covered by trigger/action kind schemas.
 * Shared by NewInstrumentModal (render extras) and buildPresetFormValue (seed defaults).
 */
export function getExtraPresetSchema(
  presetSchema: ConfigFieldSchema[],
  triggerKinds: string[],
  actionKinds: string[],
  triggerSchemas: KindSchema[],
  actionSchemas: KindSchema[]
): ConfigFieldSchema[] {
  const knownKeys = new Set([
    ...triggerKinds.flatMap((kind) => {
      const s = triggerSchemas.find((s) => s.kind === kind);
      return s?.configSchema.map((f) => f.key) ?? [];
    }),
    ...actionKinds.flatMap((kind) => {
      const s = actionSchemas.find((s) => s.kind === kind);
      return s?.configSchema.map((f) => f.key) ?? [];
    })
  ]);
  return presetSchema.filter((f) => !knownKeys.has(f.key));
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

  if (actions.length > 0 && preset.configSchema?.length) {
    const extras = getExtraPresetSchema(
      preset.configSchema, preset.triggerKinds, preset.actionKinds, triggerSchemas, actionSchemas
    );
    if (extras.length) {
      const last = actions[actions.length - 1];
      last.config = { ...last.config, ...seedDefaults(extras) };
    }
  }

  return { triggers, actions };
}
