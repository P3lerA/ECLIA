import { memo, useContext } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import type { SymphonyNodeData } from "./symphonyTypes";
import { CFG_TO_PORT, roleLabel, PORT_COLORS, SymphonyRuntimeContext } from "./symphonyTypes";
import type { PortType, PortDef } from "@eclia/symphony-protocol";

function portColor(type: PortType): string { return PORT_COLORS[type] ?? PORT_COLORS.any; }

function SymphonyNodeComponent({ data, selected, id }: NodeProps & { data: SymphonyNodeData }) {
  const { label, role, kind, schema, config } = data;
  const rt = useContext(SymphonyRuntimeContext);
  const updateNodeInternals = useUpdateNodeInternals();
  const isManualTrigger = kind === "manual-trigger";

  const dynamicInputs: PortDef[] = data.dynamicInputs ?? [];
  const dynamicOutputs: PortDef[] = data.dynamicOutputs ?? [];
  const pairedDynamic = !!(schema.dynamicInput && schema.dynamicOutput);

  // Non-empty config values to display inline
  const configEntries = schema.configSchema
    .filter((f) => config[f.key] != null && config[f.key] !== "" && f.key !== "_nextDynId")
    .map((f) => ({ label: f.label, value: f.sensitive ? "***" : String(config[f.key]) }));

  const handleAddDynPort = (dir: "input" | "output") => (e: React.MouseEvent) => {
    e.stopPropagation();
    rt.addDynamicPort(id, dir);
    // React Flow needs to recalculate handle positions after the port is added
    requestAnimationFrame(() => updateNodeInternals(id));
  };

  const handleRemoveDynPort = (dir: "input" | "output", portKey: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    rt.removeDynamicPort(id, dir, portKey);
    requestAnimationFrame(() => updateNodeInternals(id));
  };

  return (
    <div className={`sym-node${selected ? " sym-node--selected" : ""}${rt.errorNodeIds.has(id) ? " sym-node--error" : ""}`}>
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
        const hasAnyPort = schema.inputPorts.length > 0 || schema.outputPorts.length > 0
          || connectableFields.length > 0 || dynamicInputs.length > 0 || dynamicOutputs.length > 0
          || schema.dynamicInput || schema.dynamicOutput;
        if (!hasAnyPort) return null;
        return (
        <div className="sym-node-ports">
          {/* Static input ports */}
          {schema.inputPorts.map((port) => (
            <div key={port.key} className="sym-node-port sym-node-port--in">
              <Handle type="target" position={Position.Left} id={port.key} className="sym-handle" style={{ background: portColor(rt.portTypeMap.get(`${id}:${port.key}`) ?? port.type) }} />
              <span className="sym-port-label">{port.label}</span>
            </div>
          ))}
          {/* Dynamic input ports (non-paired only) */}
          {!pairedDynamic && dynamicInputs.map((port) => (
            <div key={port.key} className={`sym-node-port sym-node-port--in${schema.dynamicInput && !schema.dynamicInput.auto ? " sym-node-port--dyn" : ""}`}>
              <Handle type="target" position={Position.Left} id={port.key} className="sym-handle" style={{ background: portColor(rt.portTypeMap.get(`${id}:${port.key}`) ?? port.type) }} />
              <span className="sym-port-label">{port.label}</span>
              {schema.dynamicInput && !schema.dynamicInput.auto && <button className="sym-dyn-port-remove" onClick={handleRemoveDynPort("input", port.key)} title="Remove port">&times;</button>}
            </div>
          ))}
          {/* Add dynamic input button (non-paired, non-auto only) */}
          {!pairedDynamic && schema.dynamicInput && !schema.dynamicInput.auto && (
            <div className="sym-node-port sym-node-port--in sym-dyn-port-add-row">
              <button className="sym-dyn-port-add" onClick={handleAddDynPort("input")} title="Add input">+</button>
            </div>
          )}
          {/* Connectable config fields */}
          {connectableFields.map((f) => {
            const pt: PortType = rt.portTypeMap.get(`${id}:cfg:${f.key}`) ?? CFG_TO_PORT[f.type] ?? "any";
            return (
              <div key={`cfg_${f.key}`} className="sym-node-port sym-node-port--in">
                <Handle type="target" position={Position.Left} id={`cfg:${f.key}`} className="sym-handle" style={{ background: portColor(pt) }} />
                <span className="sym-port-label sym-port-label--cfg">{f.label}</span>
              </div>
            );
          })}
          {/* Static output ports */}
          {schema.outputPorts.map((port) => (
            <div key={port.key} className="sym-node-port sym-node-port--out">
              <span className="sym-port-label">{port.label}</span>
              <Handle type="source" position={Position.Right} id={port.key} className="sym-handle" style={{ background: portColor(rt.portTypeMap.get(`${id}:${port.key}`) ?? port.type) }} />
            </div>
          ))}
          {/* Paired dynamic ports (both input + output) */}
          {pairedDynamic && dynamicInputs.map((inPort) => {
            const suffix = inPort.key.replace("din_", "");
            const outPort = dynamicOutputs.find((p) => p.key === `dout_${suffix}`);
            return (
              <div key={inPort.key} className="sym-node-port sym-node-port--paired sym-node-port--dyn">
                <Handle type="target" position={Position.Left} id={inPort.key} className="sym-handle" style={{ background: portColor(rt.portTypeMap.get(`${id}:${inPort.key}`) ?? inPort.type) }} />
                <span className="sym-port-label">{inPort.label}</span>
                <button className="sym-dyn-port-remove" onClick={handleRemoveDynPort("input", inPort.key)} title="Remove pair">&times;</button>
                <span className="sym-paired-spacer" />
                <span className="sym-port-label">{outPort?.label ?? `Out ${suffix}`}</span>
                {outPort && <Handle type="source" position={Position.Right} id={outPort.key} className="sym-handle" style={{ background: portColor(rt.portTypeMap.get(`${id}:${outPort.key}`) ?? outPort.type) }} />}
              </div>
            );
          })}
          {/* Add paired dynamic port button */}
          {pairedDynamic && (
            <div className="sym-node-port sym-dyn-port-add-row">
              <button className="sym-dyn-port-add" onClick={handleAddDynPort("input")} title="Add port pair">+</button>
            </div>
          )}
          {/* Dynamic output ports (non-paired only) */}
          {!pairedDynamic && dynamicOutputs.map((port) => (
            <div key={port.key} className={`sym-node-port sym-node-port--out${schema.dynamicOutput && !schema.dynamicOutput.auto ? " sym-node-port--dyn" : ""}`}>
              {schema.dynamicOutput && !schema.dynamicOutput.auto && <button className="sym-dyn-port-remove" onClick={handleRemoveDynPort("output", port.key)} title="Remove port">&times;</button>}
              <span className="sym-port-label">{port.label}</span>
              <Handle type="source" position={Position.Right} id={port.key} className="sym-handle" style={{ background: portColor(rt.portTypeMap.get(`${id}:${port.key}`) ?? port.type) }} />
            </div>
          ))}
          {/* Add dynamic output button (non-paired, non-auto only) */}
          {!pairedDynamic && schema.dynamicOutput && !schema.dynamicOutput.auto && (
            <div className="sym-node-port sym-node-port--out sym-dyn-port-add-row">
              <button className="sym-dyn-port-add" onClick={handleAddDynPort("output")} title="Add output">+</button>
            </div>
          )}
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
