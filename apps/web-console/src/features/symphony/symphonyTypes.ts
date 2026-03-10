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
import { CFG_TO_PORT, resolvePortTypes, withDynamicMirrors } from "@eclia/symphony-protocol";
export { CFG_TO_PORT };

/** Runtime context passed to custom nodes via React context (avoids re-render churn). */
export interface SymphonyRuntimeCtx {
  running: boolean;
  triggerManual: (nodeId: string) => void;
  /** Resolved port types: key = "nodeId:portKey", value = effective PortType. */
  portTypeMap: Map<string, PortType>;
  /** Node IDs that have validation errors. */
  errorNodeIds: Set<string>;
  addDynamicPort: (nodeId: string, direction: "input" | "output") => void;
  removeDynamicPort: (nodeId: string, direction: "input" | "output", portKey: string) => void;
}
export const SymphonyRuntimeContext = createContext<SymphonyRuntimeCtx>({
  running: false,
  triggerManual: () => {},
  portTypeMap: new Map(),
  errorNodeIds: new Set(),
  addDynamicPort: () => {},
  removeDynamicPort: () => {},
});

// ─── Port type resolution (delegates to shared algorithm) ───

export function buildPortTypeMap(
  nodes: Node<SymphonyNodeData>[],
  edges: Edge[]
): Map<string, PortType> {
  const resolverNodes = nodes.map((n) => {
    const inPorts = [...n.data.schema.inputPorts, ...(n.data.dynamicInputs ?? [])];
    const outPorts = [...n.data.schema.outputPorts, ...(n.data.dynamicOutputs ?? [])];
    return {
      nid: n.id,
      inputPorts: inPorts,
      outputPorts: withDynamicMirrors(inPorts, outPorts),
      configSchema: n.data.schema.configSchema,
      config: n.data.config,
    };
  });
  const links = edges.map((e) => ({
    from: e.source,
    fromPort: e.sourceHandle ?? "out",
    to: e.target,
    toPort: e.targetHandle ?? "in",
  }));
  return resolvePortTypes(resolverNodes, links);
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
  /** Per-instance dynamic input ports (user-added at design time). */
  dynamicInputs?: PortDef[];
  /** Per-instance dynamic output ports (user-added at design time). */
  dynamicOutputs?: PortDef[];
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
