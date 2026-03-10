import { memo, useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SymphonyNodeData } from "./symphonyTypes";
import { CFG_TO_PORT, roleLabel, PORT_COLORS, SymphonyRuntimeContext } from "./symphonyTypes";
import type { PortType } from "@eclia/symphony-protocol";

function portColor(type: PortType): string { return PORT_COLORS[type] ?? PORT_COLORS.any; }

function SymphonyNodeComponent({ data, selected, id }: NodeProps & { data: SymphonyNodeData }) {
  const { label, role, kind, schema, config } = data;
  const rt = useContext(SymphonyRuntimeContext);
  const isManualTrigger = kind === "manual-trigger";

  // Non-empty config values to display inline
  const configEntries = schema.configSchema
    .filter((f) => config[f.key] != null && config[f.key] !== "")
    .map((f) => ({ label: f.label, value: f.sensitive ? "***" : String(config[f.key]) }));

  return (
    <div className={`sym-node${selected ? " sym-node--selected" : ""}`}>
      <div className="sym-node-header">
        <span className={`sym-node-role sym-node-role--${role}`}>{roleLabel(role)}</span>
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
              disabled={!rt.running}
              onClick={(e) => {
                e.stopPropagation();
                rt.triggerManual(id);
              }}
            >
              {rt.running ? "Fire" : "Not running"}
            </button>
          )}
        </div>
      )}

      {(() => {
        const connectableFields = schema.configSchema.filter((f) => f.connectable);
        const hasAnyPort = schema.inputPorts.length > 0 || schema.outputPorts.length > 0 || connectableFields.length > 0;
        if (!hasAnyPort) return null;
        return (
        <div className="sym-node-ports">
          {schema.inputPorts.map((port) => (
            <div key={port.key} className="sym-node-port sym-node-port--in">
              <Handle type="target" position={Position.Left} id={port.key} className="sym-handle" style={{ background: portColor(rt.portTypeMap.get(`${id}:${port.key}`) ?? port.type) }} />
              <span className="sym-port-label">{port.label}</span>
            </div>
          ))}
          {connectableFields.map((f) => {
            const pt: PortType = rt.portTypeMap.get(`${id}:cfg:${f.key}`) ?? CFG_TO_PORT[f.type] ?? "any";
            return (
              <div key={`cfg_${f.key}`} className="sym-node-port sym-node-port--in">
                <Handle type="target" position={Position.Left} id={`cfg:${f.key}`} className="sym-handle" style={{ background: portColor(pt) }} />
                <span className="sym-port-label sym-port-label--cfg">{f.label}</span>
              </div>
            );
          })}
          {schema.outputPorts.map((port) => (
            <div key={port.key} className="sym-node-port sym-node-port--out">
              <span className="sym-port-label">{port.label}</span>
              <Handle type="source" position={Position.Right} id={port.key} className="sym-handle" style={{ background: portColor(rt.portTypeMap.get(`${id}:${port.key}`) ?? port.type) }} />
            </div>
          ))}
        </div>
        );
      })()}
    </div>
  );
}

export const SymphonyNode = memo(SymphonyNodeComponent);

export const symphonyNodeTypes = {
  symphony: SymphonyNode,
};
