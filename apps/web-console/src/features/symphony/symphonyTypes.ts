import type { Node, Edge } from "@xyflow/react";
import type {
  FlowDef,
  FlowStatus,
  NodeKindSchema,
  NodeRole,
} from "@eclia/symphony-protocol";

/** A flow entry in the sidebar list. */
export interface FlowListEntry {
  id: string;
  name: string;
  enabled: boolean;
  status: FlowStatus;
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
  flows: FlowListEntry[];
  activeDef: FlowDef | null;
  nodes: SymphonyNode[];
  edges: SymphonyEdge[];
  nodeKinds: NodeKindSchema[];
  selectedNodeId: string | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
}
