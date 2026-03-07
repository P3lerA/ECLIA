import React from "react";
import { ModelRouteSelect } from "../settings/components/ModelRouteSelect";
import type { ModelRouteOption } from "../settings/settingsUtils";
import type { ConfigFieldSchema } from "../../core/api/symphony";

export function SchemaFields(props: {
  schema: ConfigFieldSchema[];
  values: Record<string, unknown>;
  onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  title?: string;
  modelRouteOptions?: ModelRouteOption[];
}) {
  const { schema, values, onChange, title, modelRouteOptions } = props;

  const set = (key: string, value: unknown) => {
    onChange((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="schemaFields">
      {title && <div className="schemaFields-title">{title}</div>}
      {schema.map((f) => (
        <SchemaField key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} modelRouteOptions={modelRouteOptions} />
      ))}
    </div>
  );
}

export function SchemaField(props: {
  field: ConfigFieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  modelRouteOptions?: ModelRouteOption[];
}) {
  const { field: f, value, onChange, modelRouteOptions } = props;

  if (f.type === "model") {
    return (
      <label className="field">
        <span className="field-label">{f.label}</span>
        <ModelRouteSelect
          value={String(value ?? "")}
          onChange={(v) => onChange(v)}
          options={modelRouteOptions ?? []}
        />
      </label>
    );
  }

  if (f.type === "boolean") {
    return (
      <label className="inlineToggle" style={{ marginTop: 4 }}>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span>{f.label}</span>
      </label>
    );
  }

  if (f.type === "select") {
    return (
      <label className="field">
        <span className="field-label">{f.label}</span>
        <select className="select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  if (f.type === "text") {
    return (
      <label className="field">
        <span className="field-label">{f.label}</span>
        <textarea
          className="newInstrument-configInput"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.placeholder}
          rows={3}
          spellCheck={false}
        />
      </label>
    );
  }

  // "string" | "number"
  return (
    <label className="field">
      <span className="field-label">{f.label}</span>
      <input
        className="select"
        type={f.sensitive ? "password" : f.type === "number" ? "number" : "text"}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(f.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
        placeholder={f.placeholder}
      />
    </label>
  );
}

export function seedDefaults(schema: ConfigFieldSchema[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}
