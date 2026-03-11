import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ValidationError,
  PortDef,
  PortType,
} from "@eclia/symphony-protocol";
import { lintGraph } from "@eclia/symphony-protocol";
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
        ...(nd.dynamicInputs?.length && { dynamicInputs: nd.dynamicInputs.map((p) => ({ ...p })) }),
        ...(nd.dynamicOutputs?.length && { dynamicOutputs: nd.dynamicOutputs.map((p) => ({ ...p })) }),
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
  return nodes.map((n) => {
    const { _nextDynId: _, ...config } = n.data.config as Record<string, unknown> & { _nextDynId?: unknown };
    return {
      nid: n.id,
      kind: n.data.kind,
      config,
      ...(n.data.dynamicInputs?.length && { dynamicInputs: n.data.dynamicInputs }),
      ...(n.data.dynamicOutputs?.length && { dynamicOutputs: n.data.dynamicOutputs }),
    };
  });
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

/** Build dynamic port label: "VAR_" + 1 → "VAR_1", "In" + 1 → "In 1". */
function dynLabel(prefix: string, n: number): string {
  return prefix.endsWith("_") ? `${prefix}${n}` : `${prefix} ${n}`;
}

// ─── Hook ───────────────────────────────────────────────────

export function useSymphonyEditor() {
  const [opusList, setOpusList] = useState<OpusListEntry[]>([]);
  const [nodeKinds, setNodeKinds] = useState<NodeKindSchema[]>([]);
  const [modelRouteOptions, setModelRouteOptions] = useState<ModelRouteOption[]>([]);
  const [activeDef, setActiveDef] = useState<OpusDef | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<OpusStatus>("stopped");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const suppressDirty = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /** Server-side validation errors (from toggleEnabled / reload failures). */
  const [serverErrors, setServerErrors] = useState<ValidationError[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<SymphonyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const kindMapRef = useRef(new Map<string, NodeKindSchema>());

  // ── Draft errors — always fresh from current canvas state ──

  const draftErrors = useMemo<ValidationError[]>(() => {
    if (nodes.length === 0) return [];
    return lintGraph(
      nodes.map((n) => ({ nid: n.id, kind: n.data.kind, config: n.data.config })),
      edges.map((e) => ({ to: e.target, toPort: e.targetHandle ?? "in" })),
      kindMapRef.current,
    );
  }, [nodes, edges]);

  // Server errors take priority (superset); when stale (user edited), fall back to draft errors.
  const validationErrors = serverErrors.length > 0 ? serverErrors : draftErrors;

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
        setRuntimeStatus("stopped");
        setServerErrors([]);
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
          setRuntimeStatus(full.status);
          setServerErrors([]);
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
      if (!suppressDirty.current) {
        const userChange = changes.some((c) =>
          c.type !== "select" && c.type !== "dimensions"
        );
        if (userChange) {
          setDirty(true);
          setServerErrors([]); // stale after edit
        }
      }
      if (changes.some((c) => c.type === "remove" && c.id === selectedNodeId)) {
        setSelectedNodeId(null);
      }
    },
    [onNodesChange, selectedNodeId]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      // Clear auto-generated dynamic outputs when their input is disconnected
      for (const c of changes) {
        if (c.type !== "remove") continue;
        const edge = edges.find((e) => e.id === c.id);
        if (!edge || edge.targetHandle !== "in") continue;
        setNodes((prev) => {
          const tgt = prev.find((n) => n.id === edge.target) as Node<SymphonyNodeData> | undefined;
          if (!tgt || !tgt.data.schema.dynamicOutput?.auto || !tgt.data.dynamicOutputs?.length) return prev;
          return prev.map((n) =>
            n.id === edge.target ? { ...n, data: { ...n.data, dynamicOutputs: [] } } : n
          );
        });
        setEdges((prev) => prev.filter((e) => e.source !== edge.target));
      }
      onEdgesChange(changes);
      if (!suppressDirty.current) {
        const userChange = changes.some((c) => c.type !== "select");
        if (userChange) {
          setDirty(true);
          setServerErrors([]); // stale after edit
        }
      }
    },
    [onEdgesChange, edges, setNodes, setEdges]
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
      // Auto-populate output ports for nodes with auto dynamicOutput (e.g. Parse)
      if (conn.targetHandle === "in") {
        setNodes((prev) => {
          const tgt = prev.find((n) => n.id === conn.target) as Node<SymphonyNodeData> | undefined;
          if (!tgt || !tgt.data.schema.dynamicOutput?.auto) return prev;
          const src = prev.find((n) => n.id === conn.source) as Node<SymphonyNodeData> | undefined;
          if (!src) return prev;
          const srcPort = src.data.schema.outputPorts.find((p) => p.key === conn.sourceHandle)
            ?? (src.data.dynamicOutputs ?? []).find((p) => p.key === conn.sourceHandle);
          const objectKeys = (srcPort as PortDef | undefined)?.objectKeys;
          if (!objectKeys || Object.keys(objectKeys).length === 0) return prev;
          // objectKeys is Record<string, PortType>; guard against legacy string[] format
          const entries: Array<[string, PortType]> = Array.isArray(objectKeys)
            ? (objectKeys as string[]).map((k) => [k, "any" as PortType])
            : Object.entries(objectKeys) as Array<[string, PortType]>;
          if (!entries.length) return prev;
          return prev.map((n) =>
            n.id === conn.target
              ? { ...n, data: { ...n.data, dynamicOutputs: entries.map(([k, t]) => ({ key: k, label: k, type: t })) } }
              : n
          );
        });
      }
      setDirty(true);
      setServerErrors([]);
    },
    [setEdges, setNodes]
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
      setRuntimeStatus(saved.status);
      setServerErrors([]);
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
      setRuntimeStatus(saved.status);
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
          setRuntimeStatus("stopped");
          setServerErrors([]);
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
          setRuntimeStatus(fresh.status);
          setServerErrors([]);
        }
      } catch (e: any) {
        if (e instanceof SymphonyValidationError) {
          setServerErrors(e.errors);
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
      if (!activeDef) return;
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
      setServerErrors([]);
    },
    [activeDef, setNodes]
  );

  // ── Duplicate node ─────────────────────────────────────

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const nid = uid();
      setNodes((prev) => {
        const src = prev.find((n) => n.id === nodeId) as Node<SymphonyNodeData> | undefined;
        if (!src) return prev;
        const clone: Node<SymphonyNodeData> = {
          id: nid,
          type: "symphony",
          position: { x: src.position.x + 40, y: src.position.y + 40 },
          data: {
            ...src.data,
            config: { ...src.data.config },
            ...(src.data.dynamicInputs && { dynamicInputs: src.data.dynamicInputs.map((p) => ({ ...p })) }),
            ...(src.data.dynamicOutputs && { dynamicOutputs: src.data.dynamicOutputs.map((p) => ({ ...p })) }),
          },
          selected: true,
        };
        return [
          ...prev.map((n) => n.id === nodeId ? { ...n, selected: false } : n),
          clone,
        ];
      });
      setSelectedNodeId(nid);
      setDirty(true);
      setServerErrors([]);
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
      setServerErrors([]);
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
      setRuntimeStatus(fresh.status);
      setServerErrors([]);
      setHint(null);
      setOpusList((prev) =>
        prev.map((f) => (f.id === activeDef.id ? opusToListEntry(fresh) : f))
      );
    } catch (e: any) {
      if (e instanceof SymphonyValidationError) {
        setServerErrors(e.errors);
      } else {
        setError(String(e?.message ?? e));
      }
    }
  }, [activeDef]);

  // ── Dynamic ports ──────────────────────────────────────

  const addDynamicPort = useCallback(
    (nodeId: string, direction: "input" | "output") => {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          const data = n.data as SymphonyNodeData;
          const template = direction === "input" ? data.schema.dynamicInput : data.schema.dynamicOutput;
          if (!template) return n;
          const counter = (data.config._nextDynId as number | undefined) ?? 0;
          const paired = !!(data.schema.dynamicInput && data.schema.dynamicOutput);

          if (paired) {
            // Add both din_X and dout_X as a pair
            const inTpl = data.schema.dynamicInput!;
            const outTpl = data.schema.dynamicOutput!;
            const existIn = (data.dynamicInputs as PortDef[] | undefined) ?? [];
            const existOut = (data.dynamicOutputs as PortDef[] | undefined) ?? [];
            const newIn: PortDef = { key: `din_${counter}`, label: dynLabel(inTpl.labelPrefix, counter + 1), type: inTpl.type };
            const newOut: PortDef = { key: `dout_${counter}`, label: dynLabel(outTpl.labelPrefix, counter + 1), type: outTpl.type };
            return {
              ...n,
              data: {
                ...data,
                config: { ...data.config, _nextDynId: counter + 1 },
                dynamicInputs: [...existIn, newIn],
                dynamicOutputs: [...existOut, newOut],
              },
            };
          }

          const prefix = direction === "input" ? "din" : "dout";
          const arrKey = direction === "input" ? "dynamicInputs" : "dynamicOutputs";
          const existing = (data[arrKey] as PortDef[] | undefined) ?? [];
          const newPort: PortDef = {
            key: `${prefix}_${counter}`,
            label: dynLabel(template.labelPrefix, counter + 1),
            type: template.type,
          };
          return {
            ...n,
            data: {
              ...data,
              config: { ...data.config, _nextDynId: counter + 1 },
              [arrKey]: [...existing, newPort],
            },
          };
        })
      );
      setDirty(true);
      setServerErrors([]);
    },
    [setNodes]
  );

  const removeDynamicPort = useCallback(
    (nodeId: string, direction: "input" | "output", portKey: string) => {
      // Compute paired port key up-front so setEdges doesn't depend on setNodes callback timing.
      const suffix = portKey.replace(/^d(in|out)_/, "");
      const pairKey = direction === "input" ? `dout_${suffix}` : `din_${suffix}`;

      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          const data = n.data as SymphonyNodeData;
          const paired = !!(data.schema.dynamicInput && data.schema.dynamicOutput);
          if (paired) {
            return {
              ...n,
              data: {
                ...data,
                dynamicInputs: (data.dynamicInputs ?? []).filter((p) => p.key !== portKey && p.key !== pairKey),
                dynamicOutputs: (data.dynamicOutputs ?? []).filter((p) => p.key !== portKey && p.key !== pairKey),
              },
            };
          }
          const arrKey = direction === "input" ? "dynamicInputs" : "dynamicOutputs";
          const existing = (data[arrKey] as PortDef[] | undefined) ?? [];
          return {
            ...n,
            data: { ...data, [arrKey]: existing.filter((p) => p.key !== portKey) },
          };
        })
      );
      // Remove all edges connected to this port (and paired port)
      setEdges((prev) =>
        prev.filter((e) => {
          if (e.target === nodeId && (e.targetHandle === portKey || e.targetHandle === pairKey)) return false;
          if (e.source === nodeId && (e.sourceHandle === portKey || e.sourceHandle === pairKey)) return false;
          return true;
        })
      );
      setDirty(true);
      setServerErrors([]);
    },
    [setNodes, setEdges]
  );

  const discardChanges = useCallback(() => {
    if (!activeDef) return;
    suppressDirty.current = true;
    setNodes(opusDefToNodes(activeDef, kindMapRef.current));
    setEdges(opusDefToEdges(activeDef));
    setSelectedNodeId(null);
    setDirty(false);
    setServerErrors([]);
    requestAnimationFrame(() => { suppressDirty.current = false; });
  }, [activeDef, setNodes, setEdges]);

  return {
    // State
    opusList,
    activeDef,
    runtimeStatus,
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
    serverErrors,
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
    addDynamicPort,
    removeDynamicPort,
    triggerManual,
    reloadOpus,
    discardChanges,
    clearError: () => setError(null),
    clearHint: () => setHint(null),
    clearValidationErrors: () => setServerErrors([]),
  };
}
