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
  OpusDef,
  OpusNodeDef,
  OpusLinkDef,
  OpusStatus,
  NodeKindSchema,
} from "@eclia/symphony-protocol";
import {
  apiListOpus,
  apiGetOpus,
  apiUpsertOpus,
  apiDeleteOpus,
  apiSetOpusEnabled,
  apiReloadOpus,
  apiListNodeKinds,
  apiTriggerNode,
  SymphonyValidationError,
  type OpusWithStatus,
} from "../../core/api/symphony";
import type { OpusListEntry, SymphonyNodeData } from "./symphonyTypes";
import { buildModelRouteOptions, type ModelRouteOption } from "../settings/settingsUtils";
import { fetchDevConfig } from "../settings/settingsInteractions";

// ─── Conversion helpers ─────────────────────────────────────

function opusDefToNodes(
  def: OpusDef,
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
        role: schema?.role ?? "process",
        config: { ...nd.config },
        schema: schema ?? fallbackSchema(nd.kind),
      },
    };
  });
}

function opusDefToEdges(def: OpusDef): Edge[] {
  return def.links.map((lk) => ({
    id: lk.lid,
    source: lk.from,
    sourceHandle: lk.fromPort,
    target: lk.to,
    targetHandle: lk.toPort,
  }));
}

function nodesToOpusNodes(nodes: Node<SymphonyNodeData>[]): OpusNodeDef[] {
  return nodes.map((n) => ({
    nid: n.id,
    kind: n.data.kind,
    config: { ...n.data.config },
  }));
}

function edgesToOpusLinks(edges: Edge[]): OpusLinkDef[] {
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

function opusToListEntry(f: OpusWithStatus): OpusListEntry {
  return { id: f.id, name: f.name, enabled: f.enabled, status: f.status };
}

function fallbackSchema(kind: string): NodeKindSchema {
  return { kind, label: `Unknown (${kind})`, role: "process", inputPorts: [], outputPorts: [], configSchema: [] };
}

function uid(): string {
  return `n_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Hook ───────────────────────────────────────────────────

export function useSymphonyEditor() {
  const [opusList, setOpusList] = useState<OpusListEntry[]>([]);
  const [nodeKinds, setNodeKinds] = useState<NodeKindSchema[]>([]);
  const [modelRouteOptions, setModelRouteOptions] = useState<ModelRouteOption[]>([]);
  const [activeDef, setActiveDef] = useState<OpusDef | null>(null);
  const [activeStatus, setActiveStatus] = useState<OpusStatus>("stopped");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const suppressDirty = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<import("@eclia/symphony-protocol").ValidationError[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<SymphonyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const kindMapRef = useRef(new Map<string, NodeKindSchema>());

  // ── Initial load ────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opusItems, kinds, cfgRes] = await Promise.all([
          apiListOpus(),
          apiListNodeKinds(),
          fetchDevConfig().catch(() => null),
        ]);
        if (cancelled) return;
        setOpusList(opusItems.map(opusToListEntry));
        setNodeKinds(kinds);
        const km = new Map<string, NodeKindSchema>();
        for (const k of kinds) km.set(k.kind, k);
        kindMapRef.current = km;
        if (cfgRes && (cfgRes as any).ok) {
          const cfg = (cfgRes as any).config;
          setModelRouteOptions(buildModelRouteOptions(
            cfg?.inference?.openai_compat?.profiles,
            cfg?.inference?.anthropic?.profiles,
            cfg?.inference?.codex_oauth?.profiles,
          ));
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Select opus ─────────────────────────────────────────

  const selectGenRef = useRef(0);

  const selectOpus = useCallback(
    (id: string | null) => {
      const gen = ++selectGenRef.current;

      if (!id) {
        setActiveDef(null);
        setActiveStatus("stopped");
        suppressDirty.current = true;
        setNodes([]);
        setEdges([]);
        setSelectedNodeId(null);
        setDirty(false);
        requestAnimationFrame(() => { suppressDirty.current = false; });
        return;
      }

      const entry = opusList.find((f) => f.id === id);
      if (!entry) return;

      (async () => {
        try {
          const full = await apiGetOpus(id);
          if (gen !== selectGenRef.current) return; // stale
          const def: OpusDef = {
            id: full.id,
            name: full.name,
            enabled: full.enabled,
            nodes: full.nodes,
            links: full.links,
            ui: full.ui,
          };
          suppressDirty.current = true;
          setActiveDef(def);
          setActiveStatus(full.status);
          setNodes(opusDefToNodes(def, kindMapRef.current));
          setEdges(opusDefToEdges(def));
          setSelectedNodeId(null);
          setDirty(false);
          requestAnimationFrame(() => { suppressDirty.current = false; });
        } catch (e: any) {
          if (gen !== selectGenRef.current) return;
          setError(String(e?.message ?? e));
        }
      })();
    },
    [opusList, setNodes, setEdges]
  );

  // ── Mark dirty on canvas change ─────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<SymphonyNodeData>>[]) => {
      onNodesChange(changes);
      // Only mark dirty for user-driven changes (position, remove, add, replace)
      if (!suppressDirty.current) {
        const userChange = changes.some((c) =>
          c.type !== "select" && c.type !== "dimensions"
        );
        if (userChange) setDirty(true);
      }
      if (changes.some((c) => c.type === "remove" && c.id === selectedNodeId)) {
        setSelectedNodeId(null);
      }
    },
    [onNodesChange, selectedNodeId]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes);
      if (!suppressDirty.current) {
        const userChange = changes.some((c) => c.type !== "select");
        if (userChange) setDirty(true);
      }
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

  const createOpus = useCallback(async (): Promise<string | null> => {
    const id = `opus_${uid()}`;
    const def: OpusDef = { id, name: "New opus", enabled: false, nodes: [], links: [] };
    try {
      const saved = await apiUpsertOpus(def);
      const entry = opusToListEntry(saved);
      suppressDirty.current = true;
      setOpusList((prev) => [...prev, entry]);
      setActiveDef(def);
      setActiveStatus(saved.status);
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
      setDirty(false);
      requestAnimationFrame(() => { suppressDirty.current = false; });
      return id;
    } catch (e: any) {
      setError(String(e?.message ?? e));
      return null;
    }
  }, [setNodes, setEdges]);

  const saveOpus = useCallback(async () => {
    if (!activeDef) return;
    const def: OpusDef = {
      ...activeDef,
      nodes: nodesToOpusNodes(nodes as Node<SymphonyNodeData>[]),
      links: edgesToOpusLinks(edges),
      ui: { ...activeDef.ui, positions: positionsFromNodes(nodes) },
    };
    try {
      const saved = await apiUpsertOpus(def);
      setActiveDef(def);
      setActiveStatus(saved.status);
      setOpusList((prev) =>
        prev.map((f) => (f.id === saved.id ? opusToListEntry(saved) : f))
      );
      setDirty(false);
      if (saved.status === "running") {
        setHint("Saved. Reload the opus to apply changes to the running instance.");
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, [activeDef, nodes, edges]);

  const deleteOpus = useCallback(
    async (id: string) => {
      try {
        await apiDeleteOpus(id);
        setOpusList((prev) => prev.filter((f) => f.id !== id));
        if (activeDef?.id === id) {
          setActiveDef(null);
          setActiveStatus("stopped");
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
        const fresh = await apiSetOpusEnabled(id, enabled);
        setOpusList((prev) =>
          prev.map((f) => (f.id === id ? opusToListEntry(fresh) : f))
        );
        if (activeDef?.id === id) {
          setActiveDef((d) => (d ? { ...d, enabled: fresh.enabled } : d));
          setActiveStatus(fresh.status);
        }
      } catch (e: any) {
        if (e instanceof SymphonyValidationError) {
          setValidationErrors(e.errors);
        } else {
          setError(String(e?.message ?? e));
        }
      }
    },
    [activeDef]
  );

  const setOpusName = useCallback(
    (name: string) => {
      if (!activeDef) return;
      setActiveDef((d) => (d ? { ...d, name } : d));
      setDirty(true);
    },
    [activeDef]
  );

  // ── Add node from palette ───────────────────────────────

  const addNode = useCallback(
    (kind: string, position?: { x: number; y: number }) => {
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
        position: position ?? { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
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

  // ── Duplicate node ─────────────────────────────────────

  const duplicateNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => {
        const src = prev.find((n) => n.id === nodeId) as Node<SymphonyNodeData> | undefined;
        if (!src) return prev;
        const nid = uid();
        const clone: Node<SymphonyNodeData> = {
          id: nid,
          type: "symphony",
          position: { x: src.position.x + 40, y: src.position.y + 40 },
          data: { ...src.data, config: { ...src.data.config } },
        };
        return [...prev, clone];
      });
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

  const reloadOpus = useCallback(async () => {
    if (!activeDef) return;
    try {
      const fresh = await apiReloadOpus(activeDef.id);
      setActiveStatus(fresh.status);
      setHint(null);
      setOpusList((prev) =>
        prev.map((f) => (f.id === activeDef.id ? opusToListEntry(fresh) : f))
      );
    } catch (e: any) {
      if (e instanceof SymphonyValidationError) {
        setValidationErrors(e.errors);
      } else {
        setError(String(e?.message ?? e));
      }
    }
  }, [activeDef]);

  const discardChanges = useCallback(() => {
    if (!activeDef) return;
    suppressDirty.current = true;
    setNodes(opusDefToNodes(activeDef, kindMapRef.current));
    setEdges(opusDefToEdges(activeDef));
    setSelectedNodeId(null);
    setDirty(false);
    requestAnimationFrame(() => { suppressDirty.current = false; });
  }, [activeDef, setNodes, setEdges]);

  return {
    // State
    opusList,
    activeDef,
    activeStatus,
    nodes,
    edges,
    nodeKinds,
    modelRouteOptions,
    selectedNodeId,
    dirty,
    loading,
    error,
    hint,
    validationErrors,
    // Canvas callbacks
    onNodesChange: handleNodesChange,
    onEdgesChange: handleEdgesChange,
    onConnect,
    onNodeClick,
    onPaneClick,
    // Actions
    selectOpus,
    createOpus,
    saveOpus,
    deleteOpus,
    toggleEnabled,
    setOpusName,
    addNode,
    duplicateNode,
    updateNodeConfig,
    triggerManual,
    reloadOpus,
    discardChanges,
    clearError: () => setError(null),
    clearHint: () => setHint(null),
    clearValidationErrors: () => setValidationErrors([]),
  };
}
