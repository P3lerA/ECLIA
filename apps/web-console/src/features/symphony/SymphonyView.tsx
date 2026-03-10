import "@xyflow/react/dist/style.css";
import "./symphony.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider, ReactFlow, Controls, Background, type Node, type Edge, type Connection } from "@xyflow/react";
import { EcliaLogo } from "../common/EcliaLogo";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { useSymphonyEditor } from "./useSymphonyEditor";
import { symphonyNodeTypes } from "./CustomNodes";
import type { SymphonyNodeData } from "./symphonyTypes";
import { roleLabel, PORT_COLORS, SymphonyRuntimeContext, buildPortTypeMap } from "./symphonyTypes";
import type { ConfigFieldSchema, NodeKindSchema, ValidationError } from "@eclia/symphony-protocol";
import type { OpusListEntry } from "./symphonyTypes";
import { ModelRouteSelect } from "../settings/components/ModelRouteSelect";
import type { ModelRouteOption } from "../settings/settingsUtils";

// ─── Main view ─────────────────────────────────────────────

export function SymphonyView() {
  const navigate = useNavigate();
  const { opusId: urlOpusId } = useParams<{ opusId?: string }>();
  const editor = useSymphonyEditor();
  const rfInstance = useRef<any>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);

  // Sync URL → editor selection
  useEffect(() => {
    if (editor.loading) return;
    if (urlOpusId && urlOpusId !== editor.activeDef?.id) {
      if (editor.opusList.some((f) => f.id === urlOpusId)) {
        editor.selectOpus(urlOpusId);
      }
    } else if (!urlOpusId && editor.activeDef) {
      editor.selectOpus(null);
    }
  }, [urlOpusId, editor.loading, editor.opusList]);

  // Fit view when switching opus
  const activeId = editor.activeDef?.id ?? null;
  useEffect(() => {
    if (!activeId || !rfInstance.current) return;
    // Delay so React Flow processes the new nodes first
    requestAnimationFrame(() => { rfInstance.current?.fitView({ padding: 0.3 }); });
  }, [activeId]);

  const handlePaneClick = useCallback(() => {
    editor.onPaneClick();
    setNodeMenu(null);
  }, [editor.onPaneClick]);

  const handlePaneDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!rfInstance.current) return;
    const pos = rfInstance.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodeMenu({ x: e.clientX, y: e.clientY, flowX: pos.x, flowY: pos.y });
  }, []);

  const portTypeMap = useMemo(
    () => buildPortTypeMap(editor.nodes as Node<SymphonyNodeData>[], editor.edges),
    [editor.nodes, editor.edges]
  );

  const isValidConnection = useCallback((conn: Connection | Edge) => {
    // Keep fast client-side validation so users cannot draw obviously invalid
    // links. The backend repeats these checks as the safety net.
    const src = editor.nodes.find((n) => n.id === conn.source) as Node<SymphonyNodeData> | undefined;
    const tgt = editor.nodes.find((n) => n.id === conn.target) as Node<SymphonyNodeData> | undefined;
    if (!src || !tgt) return false;
    const srcPort = src.data.schema.outputPorts.find((p) => p.key === conn.sourceHandle);
    if (!srcPort) return false;

    const tgtHandle = conn.targetHandle ?? "";
    if (tgtHandle.startsWith("cfg:")) {
      const cfgKey = tgtHandle.slice(4);
      if (!tgt.data.schema.configSchema.find((f) => f.key === cfgKey && f.connectable)) return false;
    } else {
      if (!tgt.data.schema.inputPorts.find((p) => p.key === tgtHandle)) return false;
    }

    // Use resolved types (typeFrom, typeFromPort, connection inference)
    const srcType = portTypeMap.get(`${conn.source}:${conn.sourceHandle}`) ?? srcPort.type;
    const tgtType = portTypeMap.get(`${conn.target}:${tgtHandle}`) ?? "any";
    if (srcType !== "any" && tgtType !== "any" && srcType !== tgtType) return false;

    // Reject if the target handle already has a connection
    const alreadyConnected = editor.edges.some(
      (e) => e.target === conn.target && e.targetHandle === tgtHandle
    );
    if (alreadyConnected) return false;

    return true;
  }, [editor.nodes, editor.edges, portTypeMap]);

  // Ctrl/Cmd+D → duplicate selected node
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "d" && (e.ctrlKey || e.metaKey) && editor.selectedNodeId) {
        e.preventDefault();
        editor.duplicateNode(editor.selectedNodeId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor.selectedNodeId, editor.duplicateNode]);

  const opusRunning = editor.activeStatus === "running";
  const runtimeCtx = useMemo(() => ({
    running: opusRunning,
    triggerManual: editor.triggerManual,
    portTypeMap,
  }), [opusRunning, editor.triggerManual, portTypeMap]);

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

  // Color edges based on resolved source port type
  const coloredEdges = editor.edges.map((e) => {
    const resolved = portTypeMap.get(`${e.source}:${e.sourceHandle}`) ?? "any";
    const color = PORT_COLORS[resolved] ?? PORT_COLORS.any;
    return { ...e, style: { ...e.style, stroke: color } };
  });

  return (
    <div className="sym-root">
      {/* Canvas */}
      <SymphonyRuntimeContext.Provider value={runtimeCtx}>
      <ReactFlowProvider>
        <div
          className="sym-canvas-wrap"
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest(".react-flow__node")) handlePaneDoubleClick(e);
          }}
        >
          {editor.activeDef ? (
            <ReactFlow
              nodes={editor.nodes}
              edges={coloredEdges}
              nodeTypes={symphonyNodeTypes}
              defaultEdgeOptions={{ interactionWidth: 20 }}
              onInit={(instance) => { rfInstance.current = instance; }}
              onNodesChange={editor.onNodesChange}
              onEdgesChange={editor.onEdgesChange}
              onConnect={editor.onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={editor.onNodeClick}
              onPaneClick={handlePaneClick}
              deleteKeyCode={["Backspace", "Delete"]}
              zoomOnDoubleClick={false}
              fitView
              fitViewOptions={{ padding: 0.3 }}
            >
              <Controls position="bottom-left" showInteractive={false} />
              <Background variant={"dots" as any} gap={18} size={1.5} color="var(--sym-dot)" />
            </ReactFlow>
          ) : (
            <div className="sym-canvas-empty">Select or create an opus</div>
          )}
        </div>
      </ReactFlowProvider>
      </SymphonyRuntimeContext.Provider>

      {/* Double-click node menu */}
      {nodeMenu && (
        <NodeMenu
          x={nodeMenu.x}
          y={nodeMenu.y}
          nodeKinds={editor.nodeKinds}
          onAdd={(kind) => { editor.addNode(kind, { x: nodeMenu.flowX, y: nodeMenu.flowY }); setNodeMenu(null); }}
          onClose={() => setNodeMenu(null)}
        />
      )}

      {/* Sidebar — opus list + node palette */}
      <Sidebar
        opusList={editor.opusList}
        activeId={editor.activeDef?.id ?? null}
        activeName={editor.activeDef?.name ?? null}
        activeRunning={opusRunning}
        dirty={editor.dirty}
        onSelect={(id) => { editor.selectOpus(id); navigate(`/symphony/${id}`, { replace: true }); }}
        onCreate={async () => { const id = await editor.createOpus(); if (id) navigate(`/symphony/${id}`, { replace: true }); }}
        onDelete={editor.deleteOpus}
        onToggleEnabled={editor.toggleEnabled}
        onNameChange={editor.setOpusName}
        onSave={editor.saveOpus}
        onDiscard={editor.discardChanges}
        onReload={editor.reloadOpus}
        hint={editor.hint}
        onBack={() => navigate("/")}
        nodeKinds={editor.nodeKinds}
        onAddNode={(kind) => {
          const pos = rfInstance.current
            ? rfInstance.current.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
            : { x: 200, y: 100 };
          editor.addNode(kind, { x: pos.x + (Math.random() - 0.5) * 60, y: pos.y + (Math.random() - 0.5) * 60 });
        }}
      />

      {/* Inspector popup — opens on node click */}
      {selectedNode && (
        <InspectorPopup
          selectedNode={selectedNode}
          opusId={editor.activeDef?.id ?? null}
          opusRunning={opusRunning}
          onUpdateConfig={editor.updateNodeConfig}
          onTrigger={editor.triggerManual}
          onClose={handlePaneClick}
          modelRouteOptions={editor.modelRouteOptions}
        />
      )}

      {/* Validation error modal */}
      {editor.validationErrors.length > 0 && (
        <ValidationModal errors={editor.validationErrors} onClose={editor.clearValidationErrors} />
      )}
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────

function Sidebar({
  opusList,
  activeId,
  activeName,
  activeRunning,
  dirty,
  onSelect,
  onCreate,
  onDelete,
  onToggleEnabled,
  onNameChange,
  onSave,
  onDiscard,
  onReload,
  hint,
  onBack,
  nodeKinds,
  onAddNode,
}: {
  opusList: OpusListEntry[];
  activeId: string | null;
  activeName: string | null;
  activeRunning: boolean;
  dirty: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
  hint: string | null;
  onBack: () => void;
  nodeKinds: NodeKindSchema[];
  onAddNode: (kind: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"opus" | "nodes" | null>("opus");
  const [panelWidth, setPanelWidth] = useState(340);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const toggleTab = (tab: "opus" | "nodes") =>
    setActiveTab((prev) => (prev === tab ? null : tab));

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: panelWidth };
    setResizing(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [panelWidth]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const next = dragRef.current.startW + (e.clientX - dragRef.current.startX);
    setPanelWidth(Math.max(180, Math.min(600, next)));
  }, []);

  const onResizePointerUp = useCallback(() => {
    dragRef.current = null;
    setResizing(false);
  }, []);

  const expanded = activeTab != null;

  return (
    <div className="sym-sidebar">
      {/* Expandable panel (left of rail) — always rendered for animation */}
      <div
        className={`sym-sidebar-panel${expanded ? "" : " sym-sidebar-panel--collapsed"}${resizing ? " sym-sidebar-panel--resizing" : ""}`}
        style={{ width: expanded ? panelWidth : 0 }}
      >
        <div className="sym-sidebar-panel-head">
          <EcliaLogo size="md" onClick={onBack} />
          <span className="sym-sidebar-panel-title">
            {activeTab === "opus" ? "Opus" : "Nodes"}
          </span>
          <ThemeModeSwitch compact />
        </div>

        <div className="sym-sidebar-body">
          {activeTab === "opus" ? (
            <>
              {activeName != null && (
                <div className="sym-flow-name-wrap">
                  <input
                    className="sym-flow-name-input"
                    value={activeName}
                    onChange={(e) => onNameChange(e.target.value)}
                    aria-label="Opus name"
                  />
                </div>
              )}

              <div className="sym-list-items">
                {opusList.length === 0 && (
                  <div className="sym-list-empty">No opus yet</div>
                )}

                {opusList.map((f) => (
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
            </>
          ) : activeTab === "nodes" ? (
            <div className="sym-node-list">
              {nodeKinds.map((k) => (
                <button
                  key={k.kind}
                  className={`sym-node-list-item sym-node-list-item--${k.role}`}
                  onClick={() => onAddNode(k.kind)}
                >
                  <span className="sym-node-list-role">{roleLabel(k.role)}</span>
                  <div className="sym-node-list-info">
                    <span className="sym-node-list-label">{k.label}</span>
                    {k.description && <span className="sym-node-list-desc">{k.description}</span>}
                  </div>
                </button>
              ))}
              {nodeKinds.length === 0 && (
                <div className="sym-list-empty">No node types available</div>
              )}
            </div>
          ) : null}
        </div>

        {activeTab === "opus" && (
          <div className="sym-sidebar-foot">
            {dirty ? (
              <div className="sym-foot-row">
                <button className="btn sym-save-btn" onClick={onSave}>Save</button>
                <button className="btn sym-discard-btn" onClick={onDiscard}>Discard</button>
              </div>
            ) : hint ? (
              <>
                <button className="btn sym-reload-btn" onClick={onReload}>Reload Runtime</button>
                <span className="sym-hint-text">{hint}</span>
              </>
            ) : (
              <>
                <button className="btn" style={{ width: "100%", fontSize: 12, padding: "7px 0" }} onClick={onCreate}>
                  + New Opus
                </button>
                {activeRunning && (
                  <button className="btn sym-reload-btn" onClick={onReload}>Reload Runtime</button>
                )}
              </>
            )}
          </div>
        )}

        {/* Resize handle */}
        <div
          className="sym-sidebar-resize"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
      </div>

      {/* Activity rail — always visible, right edge */}
      <div className="sym-sidebar-rail">
        <button
          className={`sym-rail-btn${activeTab === "opus" ? " sym-rail-btn--active" : ""}`}
          onClick={() => toggleTab("opus")}
          title="Opus"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="2" width="14" height="16" rx="2" />
            <line x1="7" y1="6" x2="13" y2="6" />
            <line x1="7" y1="10" x2="13" y2="10" />
            <line x1="7" y1="14" x2="10" y2="14" />
          </svg>
        </button>

        <button
          className={`sym-rail-btn${activeTab === "nodes" ? " sym-rail-btn--active" : ""}`}
          onClick={() => toggleTab("nodes")}
          title="Nodes"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="7" height="7" rx="1.5" />
            <rect x="11" y="2" width="7" height="7" rx="1.5" />
            <rect x="2" y="11" width="7" height="7" rx="1.5" />
            <rect x="11" y="11" width="7" height="7" rx="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Inspector popup ────────────────────────────────────────

function InspectorPopup({
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

// ─── Node menu (double-click to add) ──────────────────────

function NodeMenu({
  x,
  y,
  nodeKinds,
  onAdd,
  onClose,
}: {
  x: number;
  y: number;
  nodeKinds: NodeKindSchema[];
  onAdd: (kind: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const filtered = nodeKinds.filter((k) =>
    k.label.toLowerCase().includes(search.toLowerCase()) ||
    k.kind.toLowerCase().includes(search.toLowerCase())
  );

  // Keep menu on-screen
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 240),
    top: Math.min(y, window.innerHeight - 360),
    zIndex: 30,
  };

  return (
    <div className="sym-node-menu" style={style}>
      <input
        ref={inputRef}
        className="sym-node-menu-search"
        placeholder="Search nodes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="sym-node-menu-list">
        {filtered.map((k) => (
          <button
            key={k.kind}
            className={`sym-node-menu-item sym-node-menu-item--${k.role}`}
            onClick={() => onAdd(k.kind)}
          >
            <span className="sym-node-menu-item-role">{roleLabel(k.role)}</span>
            <span className="sym-node-menu-item-label">{k.label}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="sym-node-menu-empty">No matches</div>
        )}
      </div>
    </div>
  );
}

// ─── Validation error modal ────────────────────────────────

function ValidationModal({ errors, onClose }: { errors: ValidationError[]; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="sym-modal-backdrop" onClick={onClose}>
      <div className="sym-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sym-modal-header">
          <span className="sym-modal-title">Validation Failed</span>
          <button className="sym-modal-close" onClick={onClose}>&times;</button>
        </div>
        <ul className="sym-modal-errors">
          {errors.map((err, i) => (
            <li key={i} className="sym-modal-error-item">
              <code className="sym-modal-error-code">{err.code}</code>
              <span>{err.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
