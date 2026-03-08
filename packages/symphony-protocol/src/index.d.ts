/**
 * @eclia/symphony-protocol
 *
 * Wire types shared between the Symphony engine and its clients
 * (web-console, API consumers).  No runtime code.
 */

// ─── Port system ────────────────────────────────────────────

export type PortType = "any" | "string" | "object" | "boolean" | "number";

export interface PortDef {
  key: string;
  label: string;
  type: PortType;
  optional?: boolean;
}

// ─── Node metadata ──────────────────────────────────────────

export type NodeRole = "source" | "transform" | "sink";

export interface ConfigFieldSchema {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "text" | "select" | "model";
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  options?: string[];
}

/** Schema for a registered node kind, returned by GET /nodes. */
export interface NodeKindSchema {
  kind: string;
  label: string;
  role: NodeRole;
  description?: string;
  inputPorts: PortDef[];
  outputPorts: PortDef[];
  configSchema: ConfigFieldSchema[];
}

// ─── Flow definition ────────────────────────────────────────

export interface FlowDef {
  id: string;
  name: string;
  enabled: boolean;
  nodes: FlowNodeDef[];
  links: FlowLinkDef[];
  ui?: FlowUiMeta;
}

export interface FlowNodeDef {
  nid: string;
  kind: string;
  config: Record<string, unknown>;
}

export interface FlowLinkDef {
  lid: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface FlowUiMeta {
  positions?: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
  [key: string]: unknown;
}

// ─── Runtime status ─────────────────────────────────────────

export type FlowStatus = "stopped" | "starting" | "running" | "error";

// ─── Validation ─────────────────────────────────────────────

export interface ValidationError {
  code: string;
  message: string;
  target?: string;
}
