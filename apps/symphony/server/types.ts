/**
 * Symphony v2 — Runtime types.
 *
 * Wire types (OpusDef, PortDef, etc.) live in @eclia/symphony-protocol.
 * This file contains server-only runtime interfaces.
 */

export type {
  PortType,
  PortDef,
  NodeRole,
  ConfigFieldSchema,
  OpusDef,
  OpusNodeDef,
  OpusLinkDef,
  OpusUiMeta,
  OpusStatus,
  NodeKindSchema,
  ValidationError
} from "@eclia/symphony-protocol";

// ─── Runtime services ───────────────────────────────────────

/**
 * Injected into every node context.  Nodes use `@eclia/gateway-client`
 * functions with `services.gatewayUrl` to reach any gateway capability.
 * Extending this interface is the _only_ change needed when new
 * non-gateway services are introduced (which should be rare — the
 * gateway is the hub).
 */
export interface RuntimeServices {
  /** Resolved gateway base URL (e.g. "http://127.0.0.1:3001"). */
  gatewayUrl: string;
  /** ID of the opus this node belongs to. */
  opusId: string;
}

// ─── Node runtime ───────────────────────────────────────────

import type { NodeRole, PortDef, ConfigFieldSchema, DynamicPortTemplate } from "@eclia/symphony-protocol";

export interface NodeOutputs {
  [portKey: string]: unknown;
}

export interface NodeContext {
  inputs: Record<string, unknown>;
  services: RuntimeServices;
  state: StateAccessor;
  log: ScopedLogger;
  signal: AbortSignal;
}

export interface SourceNodeContext {
  emit(outputs: NodeOutputs): void;
  services: RuntimeServices;
  state: StateAccessor;
  log: ScopedLogger;
  signal: AbortSignal;
}

export interface SourceNode {
  readonly role: "source";
  readonly id: string;
  readonly kind: string;
  start(ctx: SourceNodeContext): Promise<void>;
  stop(): Promise<void>;
}

/** Source node that can be fired externally (e.g. manual-trigger). */
export interface TriggerableSourceNode extends SourceNode {
  trigger(payload: unknown): void;
}

export function isTriggerable(node: Node): node is TriggerableSourceNode {
  return node.role === "source" && typeof (node as TriggerableSourceNode).trigger === "function";
}

export interface ProcessNode {
  readonly role: "process" | "action" | "gate";
  readonly id: string;
  readonly kind: string;
  execute(ctx: NodeContext): Promise<NodeOutputs | null>;
}

export type Node = SourceNode | ProcessNode;

// ─── Node factory ───────────────────────────────────────────

export interface NodeFactory {
  readonly kind: string;
  readonly label: string;
  readonly role: NodeRole;
  readonly description?: string;
  readonly inputPorts: PortDef[];
  readonly outputPorts: PortDef[];
  readonly configSchema: ConfigFieldSchema[];
  /** If present, users can add/remove input ports on instances of this kind. */
  readonly dynamicInput?: DynamicPortTemplate;
  /** If present, users can add/remove output ports on instances of this kind. */
  readonly dynamicOutput?: DynamicPortTemplate;
  create(id: string, config: Record<string, unknown>, dynamicPorts?: { inputs?: PortDef[], outputs?: PortDef[] }): Node;
}

// ─── Shared services ────────────────────────────────────────

export interface StateAccessor {
  get<V = unknown>(key: string): Promise<V | undefined>;
  set<V = unknown>(key: string, value: V): Promise<void>;
}

export interface ScopedLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ─── Evaluation record ─────────────────────────────────────

export interface EvaluationRecord {
  opusId: string;
  sourceId: string;
  timestamp: number;
  durationMs: number;
  nodesRun: string[];
  nodesHalted: string[];
  error?: string;
}
