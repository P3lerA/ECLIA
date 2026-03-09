import { useCallback, useEffect, useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import type {
  FlowDef,
  FlowNodeDef,
  FlowLinkDef,
  NodeKindSchema,
} from "@eclia/symphony-protocol";
import {
  apiListFlows,
  apiUpsertFlow,
  apiDeleteFlow,
  apiSetFlowEnabled,
  apiListNodeKinds,
  apiTriggerNode,
  type FlowWithStatus,
} from "../../core/api/symphony";
import type { FlowListEntry, SymphonyNodeData } from "./symphonyTypes";

// ─── Conversion helpers ─────────────────────────────────────

function flowDefToNodes(
  def: FlowDef,
  kindMap: Map<string, NodeKindSchema>
): Node<SymphonyNodeData>[] {
  return def.nodes.map((nd) => {
    const schema = kindMap.get(nd.kind);
    const pos = def.ui?.positions?.[nd.nid] ?? { x: 0, y: 0 };
    return {
      id: nd.nid,
      type: "symphony",
      position: pos,
      data: {
        label: schema?.label ?? nd.kind,
        kind: nd.kind,
        role: schema?.role ?? "transform",
        config: { ...nd.config },
        schema: schema ?? fallbackSchema(nd.kind),
      },
    };
  });
}

function flowDefToEdges(def: FlowDef): Edge[] {
  return def.links.map((lk) => ({
    id: lk.lid,
    source: lk.from,
    sourceHandle: lk.fromPort,
    target: lk.to,
    targetHandle: lk.toPort,
  }));
}

function nodesToFlowNodes(nodes: Node<SymphonyNodeData>[]): FlowNodeDef[] {
  return nodes.map((n) => ({
    nid: n.id,
    kind: n.data.kind,
    config: { ...n.data.config },
  }));
}

function edgesToFlowLinks(edges: Edge[]): FlowLinkDef[] {
  return edges.map((e) => ({
    lid: e.id,
    from: e.source,
    fromPort: e.sourceHandle ?? "out",
    to: e.target,
    toPort: e.targetHandle ?? "in",
  }));
}

function positionsFromNodes(nodes: Node[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) out[n.id] = { x: n.position.x, y: n.position.y };
  return out;
}

function flowToListEntry(f: FlowWithStatus): FlowListEntry {
  return { id: f.id, name: f.name, enabled: f.enabled, status: f.status };
}

function fallbackSchema(kind: string): NodeKindSchema {
  return { kind, label: kind, role: "transform", inputPorts: [], outputPorts: [], configSchema: [] };
}

function uid(): string {
  return `n_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Hook ───────────────────────────────────────────────────

export function useSymphonyEditor() {
  const [flows, setFlows] = useState<FlowListEntry[]>([]);
  const [nodeKinds, setNodeKinds] = useState<NodeKindSchema[]>([]);
  const [activeDef, setActiveDef] = useState<FlowDef | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<SymphonyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const kindMapRef = useRef(new Map<string, NodeKindSchema>());

  // ── Initial load ────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowList, kinds] = await Promise.all([apiListFlows(), apiListNodeKinds()]);
        if (cancelled) return;
        setFlows(flowList.map(flowToListEntry));
        setNodeKinds(kinds);
        const km = new Map<string, NodeKindSchema>();
        for (const k of kinds) km.set(k.kind, k);
        kindMapRef.current = km;
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Select flow ─────────────────────────────────────────

  const selectFlow = useCallback(
    (id: string) => {
      const entry = flows.find((f) => f.id === id);
      if (!entry) return;

      (async () => {
        try {
          const full = await (await import("../../core/api/symphony")).apiGetFlow(id);
          const def: FlowDef = {
            id: full.id,
            name: full.name,
            enabled: full.enabled,
            nodes: full.nodes,
            links: full.links,
            ui: full.ui,
          };
          setActiveDef(def);
          setNodes(flowDefToNodes(def, kindMapRef.current));
          setEdges(flowDefToEdges(def));
          setSelectedNodeId(null);
          setDirty(false);
        } catch (e: any) {
          setError(String(e?.message ?? e));
        }
      })();
    },
    [flows, setNodes, setEdges]
  );

  // ── Mark dirty on canvas change ─────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<SymphonyNodeData>>[]) => {
      onNodesChange(changes);
      if (changes.some((c) => c.type !== "select")) setDirty(true);
    },
    [onNodesChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes);
      setDirty(true);
    },
    [onEdgesChange]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const id = `l_${uid()}`;
      setEdges((es) => [
        ...es,
        {
          id,
          source: conn.source,
          sourceHandle: conn.sourceHandle,
          target: conn.target,
          targetHandle: conn.targetHandle,
        } as Edge,
      ]);
      setDirty(true);
    },
    [setEdges]
  );

  // ── Node selection ──────────────────────────────────────

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // ── CRUD ────────────────────────────────────────────────

  const createFlow = useCallback(async () => {
    const id = `flow_${uid()}`;
    const def: FlowDef = { id, name: "New flow", enabled: false, nodes: [], links: [] };
    try {
      const saved = await apiUpsertFlow(def);
      const entry = flowToListEntry(saved);
      setFlows((prev) => [...prev, entry]);
      setActiveDef(def);
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
      setDirty(false);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, [setNodes, setEdges]);

  const saveFlow = useCallback(async () => {
    if (!activeDef) return;
    const def: FlowDef = {
      ...activeDef,
      nodes: nodesToFlowNodes(nodes as Node<SymphonyNodeData>[]),
      links: edgesToFlowLinks(edges),
      ui: { ...activeDef.ui, positions: positionsFromNodes(nodes) },
    };
    try {
      const saved = await apiUpsertFlow(def);
      setActiveDef(def);
      setFlows((prev) =>
        prev.map((f) => (f.id === saved.id ? flowToListEntry(saved) : f))
      );
      setDirty(false);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, [activeDef, nodes, edges]);

  const deleteFlow = useCallback(
    async (id: string) => {
      try {
        await apiDeleteFlow(id);
        setFlows((prev) => prev.filter((f) => f.id !== id));
        if (activeDef?.id === id) {
          setActiveDef(null);
          setNodes([]);
          setEdges([]);
          setSelectedNodeId(null);
          setDirty(false);
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    },
    [activeDef, setNodes, setEdges]
  );

  const toggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await apiSetFlowEnabled(id, enabled);
        setFlows((prev) =>
          prev.map((f) => (f.id === id ? { ...f, enabled } : f))
        );
        if (activeDef?.id === id) {
          setActiveDef((d) => (d ? { ...d, enabled } : d));
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    },
    [activeDef]
  );

  const setFlowName = useCallback(
    (name: string) => {
      if (!activeDef) return;
      setActiveDef((d) => (d ? { ...d, name } : d));
      setDirty(true);
    },
    [activeDef]
  );

  // ── Add node from palette ───────────────────────────────

  const addNode = useCallback(
    (kind: string) => {
      const schema = kindMapRef.current.get(kind);
      if (!schema) return;
      const nid = uid();
      const defaults: Record<string, unknown> = {};
      for (const f of schema.configSchema) {
        if (f.default !== undefined) defaults[f.key] = f.default;
      }
      const node: Node<SymphonyNodeData> = {
        id: nid,
        type: "symphony",
        position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: {
          label: schema.label,
          kind,
          role: schema.role,
          config: defaults,
          schema,
        },
      };
      setNodes((prev) => [...prev, node]);
      setDirty(true);
    },
    [setNodes]
  );

  // ── Update node config ──────────────────────────────────

  const updateNodeConfig = useCallback(
    (nodeId: string, key: string, value: unknown) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
            : n
        )
      );
      setDirty(true);
    },
    [setNodes]
  );

  // ── Trigger manual-trigger node ────────────────────────

  const triggerManual = useCallback(
    async (nodeId: string) => {
      if (!activeDef) return;
      try {
        await apiTriggerNode(activeDef.id, nodeId);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    },
    [activeDef]
  );

  return {
    // State
    flows,
    activeDef,
    nodes,
    edges,
    nodeKinds,
    selectedNodeId,
    dirty,
    loading,
    error,
    // Canvas callbacks
    onNodesChange: handleNodesChange,
    onEdgesChange: handleEdgesChange,
    onConnect,
    onNodeClick,
    onPaneClick,
    // Actions
    selectFlow,
    createFlow,
    saveFlow,
    deleteFlow,
    toggleEnabled,
    setFlowName,
    addNode,
    updateNodeConfig,
    triggerManual,
    clearError: () => setError(null),
  };
}
