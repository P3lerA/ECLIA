import type { Node } from "@xyflow/react";
import type { SymphonyNodeData } from "./symphonyTypes";
import { roleLabel } from "./symphonyTypes";
import type { ConfigFieldSchema } from "@eclia/symphony-protocol";
import { ModelRouteSelect } from "../settings/components/ModelRouteSelect";
import type { ModelRouteOption } from "../settings/settingsUtils";

// ─── Inspector popup ────────────────────────────────────────

export function InspectorPopup({
  selectedNode,
  opusId,
  opusRunning,
  onUpdateConfig,
  onTrigger,
  onClose,
  modelRouteOptions,
}: {
  selectedNode: Node<SymphonyNodeData>;
  opusId: string | null;
  opusRunning: boolean;
  onUpdateConfig: (nodeId: string, key: string, value: unknown) => void;
  onTrigger: (nodeId: string) => void;
  onClose: () => void;
  modelRouteOptions: ModelRouteOption[];
}) {
  return (
    <div className="sym-inspector-popup">
      <div className="sym-inspector-popup-head">
        <span className="sym-inspector-popup-head-label">Inspector</span>
        <button className="sym-inspector-close" onClick={onClose} aria-label="Close inspector">&times;</button>
      </div>
      <div className="sym-inspector-popup-body">
        <NodeInspector
          node={selectedNode}
          opusId={opusId}
          opusRunning={opusRunning}
          onUpdateConfig={onUpdateConfig}
          onTrigger={onTrigger}
          modelRouteOptions={modelRouteOptions}
        />
      </div>
    </div>
  );
}

// ─── Node inspector ────────────────────────────────────────

function NodeInspector({
  node,
  opusId,
  opusRunning,
  onUpdateConfig,
  onTrigger,
  modelRouteOptions,
}: {
  node: Node<SymphonyNodeData>;
  opusId: string | null;
  opusRunning: boolean;
  onUpdateConfig: (nodeId: string, key: string, value: unknown) => void;
  onTrigger: (nodeId: string) => void;
  modelRouteOptions: ModelRouteOption[];
}) {
  const { data } = node;
  const { schema, config } = data;
  const isManualTrigger = data.kind === "manual-trigger";

  // Auto-generated session ID for llm-process nodes
  const autoSessionId = data.kind === "llm-process" && !config.specifySessionId && opusId
    ? `sym_${opusId}_${node.id}`
    : null;

  return (
    <div className="sym-inspector-node">
      <div className="sym-inspector-header">
        <span className="sym-inspector-title">{data.label}</span>
        <span className={`sym-inspector-kind sym-node-role--${data.role}`}>{roleLabel(data.role)}</span>
      </div>
      {schema.description && <p className="sym-inspector-desc">{schema.description}</p>}

      {isManualTrigger && (
        <button
          className="btn sym-trigger-btn"
          disabled={!opusRunning}
          onClick={() => onTrigger(node.id)}
          title={opusRunning ? "Fire this trigger" : "Enable the opus first"}
        >
          {opusRunning ? "Fire" : "Not running"}
        </button>
      )}

      <div className="sym-inspector-fields">
        {schema.configSchema.map((field) => {
          // Hide sendChannelId when destination is "web" (no channel needed)
          if (field.key === "sendChannelId" && (!config.sendDestination || config.sendDestination === "web")) return null;
          // manual-trigger: hide signalValue when type is "none"; dynamically switch field type
          if (field.key === "signalValue" && isManualTrigger) {
            const st = config.signalType as string;
            if (!st || st === "none") return null;
            return <ConfigField
              key={field.key}
              field={{ ...field, type: st as any }}
              value={config[field.key]}
              onChange={(v) => onUpdateConfig(node.id, field.key, v)}
              modelRouteOptions={modelRouteOptions}
            />;
          }
          // Dynamic label for sendChannelId based on destination
          const dynField = field.key === "sendChannelId"
            ? { ...field, label: config.sendDestination === "telegram" ? "Chat ID" : "Channel ID" }
            : field;
          return <ConfigField
            key={field.key}
            field={dynField}
            value={field.key === "sessionId" && autoSessionId ? autoSessionId : config[field.key]}
            readOnly={field.key === "sessionId" && !!autoSessionId}
            onChange={(v) => onUpdateConfig(node.id, field.key, v)}
            modelRouteOptions={modelRouteOptions}
          />;
        })}
        {schema.configSchema.length === 0 && (
          <p className="sym-inspector-desc">No configuration options</p>
        )}
      </div>

    </div>
  );
}

// ─── Config field ──────────────────────────────────────────

function ConfigField({
  field,
  value,
  readOnly,
  onChange,
  modelRouteOptions,
}: {
  field: ConfigFieldSchema;
  value: unknown;
  readOnly?: boolean;
  onChange: (v: unknown) => void;
  modelRouteOptions: ModelRouteOption[];
}) {
  switch (field.type) {
    case "model":
      return (
        <div className="sym-field">
          <label className="sym-field-label">{field.label}</label>
          <ModelRouteSelect
            value={String(value ?? "")}
            onChange={onChange}
            options={modelRouteOptions}
            className="sym-field-select"
          />
        </div>
      );
    case "boolean":
      return (
        <div className="sym-field sym-field--bool">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <label className="sym-field-label">{field.label}</label>
        </div>
      );
    case "text":
      return (
        <div className="sym-field">
          <label className="sym-field-label">{field.label}</label>
          <textarea className="sym-field-textarea" value={String(value ?? "")} placeholder={field.placeholder} rows={4} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "select":
      return (
        <div className="sym-field">
          <label className="sym-field-label">{field.label}</label>
          <select className="sym-field-select" value={String(value ?? field.default ?? "")} onChange={(e) => onChange(e.target.value)}>
            {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      );
    case "number":
      return (
        <div className="sym-field">
          <label className="sym-field-label">{field.label}</label>
          <input className="sym-field-input" type="number" value={value != null ? Number(value) : ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)} />
        </div>
      );
    default: {
      const strVal = String(value ?? "");
      return (
        <div className="sym-field">
          <label className="sym-field-label">{field.label}</label>
          <input className="sym-field-input" type={field.sensitive ? "password" : "text"} value={strVal} placeholder={field.placeholder} readOnly={readOnly} onChange={readOnly ? undefined : (e) => onChange(e.target.value)} />
          {field.key === "sessionId" && strVal.trim() && (
            <a className="sym-session-link" href={`/session/${encodeURIComponent(strVal)}`} target="_blank" rel="noopener noreferrer">
              Open Session
            </a>
          )}
        </div>
      );
    }
  }
}
