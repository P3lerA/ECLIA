/**
 * @eclia/symphony-protocol
 *
 * Wire types shared between the Symphony engine and its clients
 * (web-console, API consumers).  No runtime code.
 */

// ─── Port system ────────────────────────────────────────────

export type PortType = "any" | "string" | "object" | "boolean" | "number";

/** Maps ConfigFieldSchema.type → PortType for connectable config fields. */
export const CFG_TO_PORT: Record<string, PortType>;

export interface PortDef {
  key: string;
  label: string;
  type: PortType;
  optional?: boolean;
  /** Config key whose value determines the actual port type at design time. */
  typeFrom?: string;
  /** Input port key on the same node whose resolved type this output mirrors. */
  typeFromPort?: string;
}

// ─── Node metadata ──────────────────────────────────────────

export type NodeRole = "source" | "process" | "action" | "gate";

export interface ConfigFieldSchema {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "text" | "select" | "model";
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  options?: string[];
  /** If true, this field also appears as an input port. Wired values override config. */
  connectable?: boolean;
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

// ─── Opus definition ────────────────────────────────────────

export interface OpusDef {
  id: string;
  name: string;
  enabled: boolean;
  nodes: OpusNodeDef[];
  links: OpusLinkDef[];
  ui?: OpusUiMeta;
}

export interface OpusNodeDef {
  nid: string;
  kind: string;
  config: Record<string, unknown>;
}

export interface OpusLinkDef {
  lid: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface OpusUiMeta {
  positions?: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
  [key: string]: unknown;
}

// ─── Runtime status ─────────────────────────────────────────

export type OpusStatus = "stopped" | "starting" | "running" | "error";

// ─── Validation ─────────────────────────────────────────────

export interface ValidationError {
  code: string;
  message: string;
  target?: string;
}
