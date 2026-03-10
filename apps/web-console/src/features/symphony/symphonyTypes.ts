import { createContext } from "react";
import type { Node, Edge } from "@xyflow/react";
import type {
  OpusDef,
  OpusStatus,
  NodeKindSchema,
  NodeRole,
  PortType,
  PortDef,
} from "@eclia/symphony-protocol";
import { CFG_TO_PORT } from "@eclia/symphony-protocol";
export { CFG_TO_PORT };

/** Runtime context passed to custom nodes via React context (avoids re-render churn). */
export interface SymphonyRuntimeCtx {
  running: boolean;
  triggerManual: (nodeId: string) => void;
  /** Resolved port types: key = "nodeId:portKey", value = effective PortType. */
  portTypeMap: Map<string, PortType>;
  /** Node IDs that have validation errors. */
  errorNodeIds: Set<string>;
}
export const SymphonyRuntimeContext = createContext<SymphonyRuntimeCtx>({
  running: false,
  triggerManual: () => {},
  portTypeMap: new Map(),
  errorNodeIds: new Set(),
});

// ─── Port type resolution ───────────────────────────────────

/** Resolve a port's effective type from its config (typeFrom). */
function resolvePortType(port: PortDef, config: Record<string, unknown>): PortType {
  if (port.typeFrom) {
    const v = String(config[port.typeFrom] ?? "");
    if (v === "string" || v === "number" || v === "boolean" || v === "object") return v;
  }
  return port.type;
}

/**
 * Build a map of effective port types for all nodes.
 * 1. typeFrom — resolve from config values.
 * 2. Iterate: connection inference + typeFromPort mirroring until stable.
 */
export function buildPortTypeMap(
  nodes: Node<SymphonyNodeData>[],
  edges: Edge[]
): Map<string, PortType> {
  const map = new Map<string, PortType>();
  // Ports whose type is authoritatively set by typeFrom — inference must not override.
  const frozen = new Set<string>();

  // Collect typeFromPort declarations for iteration.
  const mirrors: Array<{ nodeId: string; outKey: string; inKeys: string[] }> = [];

  for (const node of nodes) {
    const { schema, config } = node.data;
    for (const port of schema.inputPorts) {
      map.set(`${node.id}:${port.key}`, resolvePortType(port, config));
      if (port.typeFrom) frozen.add(`${node.id}:${port.key}`);
    }
    for (const port of schema.outputPorts) {
      map.set(`${node.id}:${port.key}`, resolvePortType(port, config));
      if (port.typeFrom) frozen.add(`${node.id}:${port.key}`);
      if (port.typeFromPort) {
        const inKeys = Array.isArray(port.typeFromPort) ? port.typeFromPort : [port.typeFromPort];
        mirrors.push({ nodeId: node.id, outKey: port.key, inKeys });
      }
    }
    for (const f of schema.configSchema) {
      if (f.connectable) {
        map.set(`${node.id}:cfg:${f.key}`, CFG_TO_PORT[f.type] ?? "any");
      }
    }
  }

  // Iterate connection inference + typeFromPort until stable (max 10 rounds).
  for (let i = 0; i < 10; i++) {
    let changed = false;

    // Connection inference
    for (const edge of edges) {
      const srcKey = `${edge.source}:${edge.sourceHandle}`;
      const tgtKey = `${edge.target}:${edge.targetHandle}`;
      const srcType = map.get(srcKey) ?? "any";
      const tgtType = map.get(tgtKey) ?? "any";
      if (srcType === "any" && tgtType !== "any" && !frozen.has(srcKey)) { map.set(srcKey, tgtType); changed = true; }
      else if (tgtType === "any" && srcType !== "any" && !frozen.has(tgtKey)) { map.set(tgtKey, srcType); changed = true; }
    }

    // typeFromPort — forward: input(s) → output
    for (const { nodeId, outKey, inKeys } of mirrors) {
      const outKey_ = `${nodeId}:${outKey}`;
      if (frozen.has(outKey_)) continue;
      const outType = map.get(outKey_) ?? "any";
      if (outType !== "any") continue;
      if (inKeys.length === 1) {
        const t = map.get(`${nodeId}:${inKeys[0]}`) ?? "any";
        if (t !== "any") { map.set(`${nodeId}:${outKey}`, t); changed = true; }
      } else {
        let unanimous: PortType | null = null;
        for (const k of inKeys) {
          const t = map.get(`${nodeId}:${k}`) ?? "any";
          if (t === "any") { unanimous = null; break; }
          if (unanimous === null) unanimous = t;
          else if (t !== unanimous) { unanimous = null; break; }
        }
        if (unanimous) { map.set(`${nodeId}:${outKey}`, unanimous); changed = true; }
      }
    }

    // typeFromPort — reverse: output → input(s)
    for (const { nodeId, outKey, inKeys } of mirrors) {
      const outType = map.get(`${nodeId}:${outKey}`) ?? "any";
      if (outType === "any") continue;
      for (const k of inKeys) {
        const inKey = `${nodeId}:${k}`;
        if (!frozen.has(inKey) && (map.get(inKey) ?? "any") === "any") {
          map.set(inKey, outType); changed = true;
        }
      }
    }

    if (!changed) break;
  }

  return map;
}

export function roleLabel(role: string): string { return role.charAt(0).toUpperCase() + role.slice(1); }

export const PORT_COLORS: Record<PortType, string> = {
  any: "var(--sym-port-any)", string: "var(--sym-port-string)", object: "var(--sym-port-object)",
  number: "var(--sym-port-number)", boolean: "var(--sym-port-boolean)",
};

/** An opus entry in the sidebar list. */
export interface OpusListEntry {
  id: string;
  name: string;
  enabled: boolean;
  status: OpusStatus;
}

/** Data payload embedded in each React Flow node. */
export interface SymphonyNodeData {
  label: string;
  kind: string;
  role: NodeRole;
  config: Record<string, unknown>;
  schema: NodeKindSchema;
  [key: string]: unknown;
}

export type SymphonyNode = Node<SymphonyNodeData>;
export type SymphonyEdge = Edge;

/** Top-level editor state returned by useSymphonyEditor. */
export interface EditorState {
  opusList: OpusListEntry[];
  activeDef: OpusDef | null;
  nodes: SymphonyNode[];
  edges: SymphonyEdge[];
  nodeKinds: NodeKindSchema[];
  selectedNodeId: string | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
}
