import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SymphonyNodeData } from "./symphonyTypes";

function SymphonyNodeComponent({ data, selected }: NodeProps & { data: SymphonyNodeData }) {
  const { label, role, kind, schema, config } = data;
  const isManualTrigger = kind === "manual-trigger";

  // Non-empty config values to display inline
  const configEntries = schema.configSchema
    .filter((f) => config[f.key] != null && config[f.key] !== "")
    .map((f) => ({ label: f.label, value: f.sensitive ? "***" : String(config[f.key]) }));

  return (
    <div className={`sym-node${selected ? " sym-node--selected" : ""}`}>
      <div className="sym-node-header">
        <span className={`sym-node-role sym-node-role--${role}`}>{role}</span>
        <span className="sym-node-label">{label}</span>
      </div>

      {(configEntries.length > 0 || isManualTrigger) && (
        <div className="sym-node-body">
          {configEntries.map((e) => (
            <div key={e.label} className="sym-node-config-row">
              <span className="sym-node-config-key">{e.label}</span>
              <span className="sym-node-config-val">{e.value}</span>
            </div>
          ))}
          {isManualTrigger && (
            <button
              className="btn sym-node-fire-btn"
              disabled={!data._flowRunning}
              onClick={(e) => {
                e.stopPropagation();
                (data._onTrigger as ((id: string) => void))?.(data._nodeId as string);
              }}
            >
              {data._flowRunning ? "Fire" : "Not running"}
            </button>
          )}
        </div>
      )}

      <div className="sym-node-ports">
        {schema.inputPorts.map((port, i) => (
          <div key={port.key} className="sym-node-port">
            <Handle
              type="target"
              position={Position.Left}
              id={port.key}
              className="sym-handle"
              style={{ top: `${28 + (schema.inputPorts.length > 1 ? i * 20 : 0)}px` }}
            />
            <span className="sym-port-label">{port.label}</span>
          </div>
        ))}

        {schema.outputPorts.map((port, i) => (
          <div key={port.key} className="sym-node-port" style={{ justifyContent: "flex-end" }}>
            <span className="sym-port-label">{port.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.key}
              className="sym-handle"
              style={{ top: `${28 + (schema.outputPorts.length > 1 ? i * 20 : 0)}px` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const SymphonyNode = memo(SymphonyNodeComponent);

export const symphonyNodeTypes = {
  symphony: SymphonyNode,
};
