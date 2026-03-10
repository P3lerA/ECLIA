import "@xyflow/react/dist/style.css";
import "./symphony.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider, ReactFlow, Controls, Background, type Node, type Edge, type Connection } from "@xyflow/react";
import { useSymphonyEditor } from "./useSymphonyEditor";
import { symphonyNodeTypes } from "./CustomNodes";
import type { SymphonyNodeData } from "./symphonyTypes";
import { PORT_COLORS, SymphonyRuntimeContext, buildPortTypeMap } from "./symphonyTypes";
import { Sidebar } from "./Sidebar";
import { InspectorPopup } from "./InspectorPopup";
import { NodeMenu } from "./NodeMenu";
import { ValidationModal } from "./ValidationModal";

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
    if (tgtType !== "any" && srcType !== tgtType) return false;

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

  // Collect edge/node IDs that have validation errors
  const [errorEdgeIds, errorNodeIds] = useMemo(() => {
    const edges = new Set<string>();
    const nodes = new Set<string>();
    const edgeIdSet = new Set(editor.edges.map((e) => e.id));
    const nodeIdSet = new Set(editor.nodes.map((n) => n.id));
    for (const err of editor.validationErrors) {
      if (!err.target) continue;
      if (edgeIdSet.has(err.target)) edges.add(err.target);
      else if (nodeIdSet.has(err.target)) nodes.add(err.target);
    }
    return [edges, nodes] as const;
  }, [editor.validationErrors, editor.edges, editor.nodes]);

  const opusRunning = editor.activeStatus === "running";
  const runtimeCtx = useMemo(() => ({
    running: opusRunning,
    triggerManual: editor.triggerManual,
    portTypeMap,
    errorNodeIds,
  }), [opusRunning, editor.triggerManual, portTypeMap, errorNodeIds]);

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

  // Color edges based on resolved source port type; mark error edges red
  const coloredEdges = editor.edges.map((e) => {
    if (errorEdgeIds.has(e.id)) {
      return { ...e, style: { ...e.style, stroke: "var(--danger, #ef4444)" }, animated: true };
    }
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
