/**
 * Symphony v2 — Runtime types.
 *
 * Wire types (FlowDef, PortDef, etc.) live in @eclia/symphony-protocol.
 * This file contains server-only runtime interfaces.
 */

export type {
  PortType,
  PortDef,
  NodeRole,
  ConfigFieldSchema,
  FlowDef,
  FlowNodeDef,
  FlowLinkDef,
  FlowUiMeta,
  FlowStatus,
  NodeKindSchema,
  ValidationError
} from "@eclia/symphony-protocol";

// ─── Node runtime ───────────────────────────────────────────

import type { NodeRole, PortDef, ConfigFieldSchema } from "@eclia/symphony-protocol";

export interface NodeOutputs {
  [portKey: string]: unknown;
}

export interface NodeContext {
  inputs: Record<string, unknown>;
  state: StateAccessor;
  log: ScopedLogger;
  signal: AbortSignal;
}

export interface SourceNodeContext {
  emit(outputs: NodeOutputs): void;
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

export interface ProcessNode {
  readonly role: "transform" | "sink";
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
  create(id: string, config: Record<string, unknown>): Node;
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
