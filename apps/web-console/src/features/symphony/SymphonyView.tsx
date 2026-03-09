import "@xyflow/react/dist/style.css";
import "./symphony.css";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReactFlowProvider, ReactFlow, Controls, Background, type Node } from "@xyflow/react";
import { EcliaLogo } from "../common/EcliaLogo";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { useSymphonyEditor } from "./useSymphonyEditor";
import { symphonyNodeTypes } from "./CustomNodes";
import type { SymphonyNodeData } from "./symphonyTypes";
import type { ConfigFieldSchema, NodeKindSchema } from "@eclia/symphony-protocol";
import type { FlowListEntry } from "./symphonyTypes";

// ─── Drag hook ─────────────────────────────────────────────

function usePanelDrag(initialPos: { x: number; y: number }) {
  const [pos, setPos] = useState(initialPos);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Don't drag if clicking a button/input inside the head
    if ((e.target as HTMLElement).closest("button, input, select, textarea, label")) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return { pos, dragHandlers: { onPointerDown, onPointerMove, onPointerUp } };
}

// ─── Main view ─────────────────────────────────────────────

export function SymphonyView() {
  const navigate = useNavigate();
  const editor = useSymphonyEditor();

  if (editor.loading) {
    return <div className="sym-root"><div className="sym-loading">Loading...</div></div>;
  }

  if (editor.error) {
    return (
      <div className="sym-root">
        <div className="sym-error">
          <span>{editor.error}</span>
          <button className="btn" onClick={editor.clearError}>Dismiss</button>
        </div>
      </div>
    );
  }

  const selectedNode = editor.selectedNodeId
    ? (editor.nodes.find((n) => n.id === editor.selectedNodeId) as Node<SymphonyNodeData> | undefined)
    : undefined;

  // Inject runtime props into node data for inline rendering
  const flowRunning = editor.activeDef?.enabled ?? false;
  const enrichedNodes = editor.nodes.map((n) => ({
    ...n,
    data: { ...n.data, _flowRunning: flowRunning, _onTrigger: editor.triggerManual, _nodeId: n.id },
  }));

  return (
    <div className="sym-root">
      {/* Canvas */}
      <ReactFlowProvider>
        <div className="sym-canvas-wrap">
          {editor.activeDef ? (
            <ReactFlow
              nodes={enrichedNodes}
              edges={editor.edges}
              nodeTypes={symphonyNodeTypes}
              onNodesChange={editor.onNodesChange}
              onEdgesChange={editor.onEdgesChange}
              onConnect={editor.onConnect}
              onNodeClick={editor.onNodeClick}
              onPaneClick={editor.onPaneClick}
              fitView
            >
              <Controls position="bottom-left" showInteractive={false} />
              <Background variant={"dots" as any} gap={18} size={1.5} color="var(--line)" />
            </ReactFlow>
          ) : (
            <div className="sym-canvas-empty">Select or create a flow</div>
          )}
        </div>
      </ReactFlowProvider>

      {/* Floating palette */}
      {editor.activeDef && editor.nodeKinds.length > 0 && (
        <Palette nodeKinds={editor.nodeKinds} onAdd={editor.addNode} />
      )}

      {/* Left panel — flows */}
      <LeftPanel
        flows={editor.flows}
        activeId={editor.activeDef?.id ?? null}
        activeName={editor.activeDef?.name ?? null}
        onSelect={editor.selectFlow}
        onCreate={editor.createFlow}
        onDelete={editor.deleteFlow}
        onToggleEnabled={editor.toggleEnabled}
        onNameChange={editor.setFlowName}
        onBack={() => navigate("/")}
      />

      {/* Right panel — inspector */}
      <RightPanel
        selectedNode={selectedNode}
        flowRunning={editor.activeDef?.enabled ?? false}
        onUpdateConfig={editor.updateNodeConfig}
        onTrigger={editor.triggerManual}
      />

      {/* Save bar */}
      {editor.dirty && (
        <div className="sym-save-bar">
          <span className="sym-save-dot" />
          <span className="sym-save-text">Unsaved changes</span>
          <button className="btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={editor.saveFlow}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Left panel ────────────────────────────────────────────

function LeftPanel({
  flows,
  activeId,
  activeName,
  onSelect,
  onCreate,
  onDelete,
  onToggleEnabled,
  onNameChange,
  onBack,
}: {
  flows: FlowListEntry[];
  activeId: string | null;
  activeName: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onNameChange: (name: string) => void;
  onBack: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { pos, dragHandlers } = usePanelDrag({ x: 14, y: 14 });

  return (
    <div
      className={`sym-panel sym-panel--left${collapsed ? " sym-panel--collapsed" : ""}`}
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="sym-panel-head" {...dragHandlers}>
        <div className="sym-panel-head-left">
          <EcliaLogo size="sm" onClick={onBack} />
          <span className="sym-panel-head-label">Flows</span>
        </div>
        <button
          className="sym-panel-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand panel" : "Collapse panel"}
        >
          {collapsed ? "\u25B8" : "\u25BE"}
        </button>
      </div>

      <div className="sym-panel-body">
        {/* Active flow name */}
        {activeName != null && (
          <div className="sym-flow-name-wrap">
            <input
              className="sym-flow-name-input"
              value={activeName}
              onChange={(e) => onNameChange(e.target.value)}
              aria-label="Flow name"
            />
          </div>
        )}

        <div className="sym-list-items">
          {flows.length === 0 && (
            <div className="sym-list-empty">No flows yet</div>
          )}

          {flows.map((f) => (
            <div
              key={f.id}
              className={`sym-list-item${f.id === activeId ? " sym-list-item--active" : ""}`}
              onClick={() => onSelect(f.id)}
            >
              <div className="sym-list-item-top">
                <span className="sym-list-item-name">{f.name}</span>
                <span className={`sym-status sym-status--${f.status}`}>{f.status}</span>
              </div>
              <div className="sym-list-item-actions">
                <label className="sym-toggle-label" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    onChange={(e) => onToggleEnabled(f.id, e.target.checked)}
                  />
                  <span>On</span>
                </label>
                <button
                  className="btn subtle"
                  style={{ padding: "2px 7px", fontSize: 10, color: "var(--danger)", borderRadius: 8 }}
                  onClick={(e) => { e.stopPropagation(); onDelete(f.id); }}
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sym-panel-foot">
        <button
          className="btn"
          style={{ width: "100%", fontSize: 12, padding: "7px 0" }}
          onClick={onCreate}
        >
          + New flow
        </button>
      </div>
    </div>
  );
}

// ─── Right panel ───────────────────────────────────────────

function RightPanel({
  selectedNode,
  flowRunning,
  onUpdateConfig,
  onTrigger,
}: {
  selectedNode: Node<SymphonyNodeData> | undefined;
  flowRunning: boolean;
  onUpdateConfig: (nodeId: string, key: string, value: unknown) => void;
  onTrigger: (nodeId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { pos, dragHandlers } = usePanelDrag({ x: window.innerWidth - 270 - 14, y: 14 });

  return (
    <div
      className={`sym-panel sym-panel--right${collapsed ? " sym-panel--collapsed" : ""}`}
      style={{ left: pos.x, top: pos.y, right: "auto" }}
    >
      <div className="sym-panel-head" {...dragHandlers}>
        <div className="sym-panel-head-left">
          <span className="sym-panel-head-label">Inspector</span>
        </div>
        <ThemeModeSwitch compact />
        <button
          className="sym-panel-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand inspector" : "Collapse inspector"}
        >
          {collapsed ? "\u25B8" : "\u25BE"}
        </button>
      </div>

      <div className="sym-panel-body">
        {!selectedNode ? (
          <div className="sym-inspector-empty">
            Select a node to inspect
          </div>
        ) : (
          <NodeInspector node={selectedNode} flowRunning={flowRunning} onUpdateConfig={onUpdateConfig} onTrigger={onTrigger} />
        )}
      </div>
    </div>
  );
}

// ─── Node inspector ────────────────────────────────────────

function NodeInspector({
  node,
  flowRunning,
  onUpdateConfig,
  onTrigger,
}: {
  node: Node<SymphonyNodeData>;
  flowRunning: boolean;
  onUpdateConfig: (nodeId: string, key: string, value: unknown) => void;
  onTrigger: (nodeId: string) => void;
}) {
  const { data } = node;
  const { schema, config } = data;
  const isManualTrigger = data.kind === "manual-trigger";

  return (
    <div className="sym-inspector-node">
      <div className="sym-inspector-header">
        <span className="sym-inspector-title">{data.label}</span>
        <span className={`sym-inspector-kind sym-node-role--${data.role}`}>{data.role}</span>
      </div>
      {schema.description && <p className="sym-inspector-desc">{schema.description}</p>}

      {isManualTrigger && (
        <button
          className="btn sym-trigger-btn"
          disabled={!flowRunning}
          onClick={() => onTrigger(node.id)}
          title={flowRunning ? "Fire this trigger" : "Enable the flow first"}
        >
          {flowRunning ? "Fire" : "Flow not running"}
        </button>
      )}

      <div className="sym-inspector-fields">
        {schema.configSchema.map((field) => (
          <ConfigField
            key={field.key}
            field={field}
            value={config[field.key]}
            onChange={(v) => onUpdateConfig(node.id, field.key, v)}
          />
        ))}
        {schema.configSchema.length === 0 && !isManualTrigger && (
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
  onChange,
}: {
  field: ConfigFieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
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
          <select className="sym-field-select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            <option value="">--</option>
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
    default:
      return (
        <div className="sym-field">
          <label className="sym-field-label">{field.label}</label>
          <input className="sym-field-input" type={field.sensitive ? "password" : "text"} value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
  }
}

// ─── Palette ───────────────────────────────────────────────

function Palette({ nodeKinds, onAdd }: { nodeKinds: NodeKindSchema[]; onAdd: (kind: string) => void }) {
  return (
    <div className="sym-palette">
      <div className="sym-palette-items">
        {nodeKinds.map((k) => (
          <button
            key={k.kind}
            className={`sym-palette-btn sym-palette-btn--${k.role}`}
            onClick={() => onAdd(k.kind)}
            title={k.description}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
