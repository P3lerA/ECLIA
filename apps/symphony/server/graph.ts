import type { OpusDef, OpusLinkDef, ValidationError } from "./types.js";
import type { PortType, PortDef } from "@eclia/symphony-protocol";
import { CFG_TO_PORT } from "@eclia/symphony-protocol";
import type { Registry } from "./registry.js";

// ─── Port type resolution (shared with frontend) ────────────

function resolveStaticType(port: PortDef, config: Record<string, unknown>): PortType {
  if (port.typeFrom) {
    const v = String(config[port.typeFrom] ?? "");
    if (v === "string" || v === "number" || v === "boolean" || v === "object") return v;
  }
  return port.type;
}

/** Build resolved port type map — same algorithm as the frontend's buildPortTypeMap. */
function buildResolvedTypes(def: OpusDef, registry: Registry): Map<string, PortType> {
  const map = new Map<string, PortType>();
  const mirrors: Array<{ nid: string; outKey: string; inKey: string }> = [];

  for (const nd of def.nodes) {
    const f = registry.get(nd.kind);
    if (!f) continue;
    for (const port of f.inputPorts) map.set(`${nd.nid}:${port.key}`, resolveStaticType(port, nd.config));
    for (const port of f.outputPorts) {
      map.set(`${nd.nid}:${port.key}`, resolveStaticType(port, nd.config));
      if (port.typeFromPort) mirrors.push({ nid: nd.nid, outKey: port.key, inKey: port.typeFromPort });
    }
    for (const field of f.configSchema) {
      if (field.connectable) map.set(`${nd.nid}:cfg:${field.key}`, CFG_TO_PORT[field.type] ?? "any");
    }
  }

  for (let i = 0; i < 10; i++) {
    let changed = false;
    for (const lk of def.links) {
      const sKey = `${lk.from}:${lk.fromPort}`, tKey = `${lk.to}:${lk.toPort}`;
      const sType = map.get(sKey) ?? "any", tType = map.get(tKey) ?? "any";
      if (sType === "any" && tType !== "any") { map.set(sKey, tType); changed = true; }
      else if (tType === "any" && sType !== "any") { map.set(tKey, sType); changed = true; }
    }
    for (const { nid, outKey, inKey } of mirrors) {
      const inT = map.get(`${nid}:${inKey}`) ?? "any", outT = map.get(`${nid}:${outKey}`) ?? "any";
      if (outT === "any" && inT !== "any") { map.set(`${nid}:${outKey}`, inT); changed = true; }
    }
    if (!changed) break;
  }
  return map;
}

// ─── Validation ─────────────────────────────────────────────

export class OpusValidationError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(`invalid opus: ${errors.map((e) => e.message).join("; ")}`);
    this.errors = errors;
  }
}

/**
 * Validate an opus definition against the registry.
 * Returns an empty array if the opus is valid.
 */
export function validateOpus(def: OpusDef, registry: Registry): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeMap = new Map(def.nodes.map((n) => [n.nid, n]));
  const resolved = buildResolvedTypes(def, registry);

  // Server-side validation is authoritative. The editor should prevent
  // invalid links interactively, but the backend must still reject
  // malformed graphs from stale clients or direct API writes.

  // 1. Every node kind must exist in the registry.
  for (const nd of def.nodes) {
    if (!registry.get(nd.kind)) {
      errors.push({ code: "unknown_kind", message: `unknown node kind: "${nd.kind}"`, target: nd.nid });
    }
  }

  // 2. Links reference valid nodes and ports.
  for (const lk of def.links) {
    if (!nodeMap.has(lk.from)) {
      errors.push({ code: "bad_link_source", message: `link "${lk.lid}" references unknown source node "${lk.from}"`, target: lk.lid });
    }
    if (!nodeMap.has(lk.to)) {
      errors.push({ code: "bad_link_target", message: `link "${lk.lid}" references unknown target node "${lk.to}"`, target: lk.lid });
    }
    // Port existence + type compatibility checked only if both kinds are known.
    const fromNode = nodeMap.get(lk.from);
    const toNode = nodeMap.get(lk.to);
    if (fromNode && toNode) {
      const ff = registry.get(fromNode.kind);
      const tf = registry.get(toNode.kind);
      const srcPort = ff?.outputPorts.find((p) => p.key === lk.fromPort);
      if (ff && !srcPort) {
        errors.push({ code: "bad_output_port", message: `node "${lk.from}" (${fromNode.kind}) has no output port "${lk.fromPort}"`, target: lk.lid });
      }
      if (tf) {
        let tgtType: PortType | undefined;
        // cfg: ports target connectable config fields, not inputPorts
        if (lk.toPort.startsWith("cfg:")) {
          const cfgKey = lk.toPort.slice(4);
          const cfgField = tf.configSchema.find((f) => f.key === cfgKey && f.connectable);
          if (!cfgField) {
            errors.push({ code: "bad_input_port", message: `node "${lk.to}" (${toNode.kind}) has no connectable config field "${cfgKey}"`, target: lk.lid });
          } else {
            tgtType = CFG_TO_PORT[cfgField.type] ?? "any";
          }
        } else {
          const tgtPort = tf.inputPorts.find((p) => p.key === lk.toPort);
          if (!tgtPort) {
            errors.push({ code: "bad_input_port", message: `node "${lk.to}" (${toNode.kind}) has no input port "${lk.toPort}"`, target: lk.lid });
          } else {
            tgtType = tgtPort.type;
          }
        }
        // Type compatibility using resolved types (typeFrom, typeFromPort, connection inference).
        if (srcPort && tgtType) {
          const rSrc = resolved.get(`${lk.from}:${lk.fromPort}`) ?? srcPort.type;
          const rTgt = resolved.get(`${lk.to}:${lk.toPort}`) ?? tgtType;
          if (rSrc !== "any" && rTgt !== "any" && rSrc !== rTgt) {
            errors.push({ code: "type_mismatch", message: `link "${lk.lid}": output type "${rSrc}" is incompatible with input type "${rTgt}"`, target: lk.lid });
          }
        }
      }
    }
  }

  // 3. No duplicate links to the same input port.
  const seenInputs = new Set<string>();
  for (const lk of def.links) {
    const key = `${lk.to}:${lk.toPort}`;
    if (seenInputs.has(key)) {
      const node = nodeMap.get(lk.to);
      errors.push({ code: "duplicate_input", message: `input port "${lk.toPort}" on node "${lk.to}" (${node?.kind ?? "?"}) has multiple incoming links`, target: lk.lid });
    }
    seenInputs.add(key);
  }

  // 4. No cycles.
  try {
    topoSort([...nodeMap.keys()], def.links);
  } catch {
    errors.push({ code: "cycle", message: "opus contains a cycle" });
  }

  // 5. Required config fields must have a value (or be connected via cfg: link).
  const connectedCfgKeys = new Set<string>();
  for (const lk of def.links) {
    if (lk.toPort.startsWith("cfg:")) {
      connectedCfgKeys.add(`${lk.to}:${lk.toPort.slice(4)}`);
    }
  }
  for (const nd of def.nodes) {
    const f = registry.get(nd.kind);
    if (!f) continue;
    for (const field of f.configSchema) {
      if (!field.required) continue;
      const hasValue = nd.config[field.key] != null && nd.config[field.key] !== "";
      const hasConnection = connectedCfgKeys.has(`${nd.nid}:${field.key}`);
      if (!hasValue && !hasConnection) {
        errors.push({ code: "missing_config", message: `node "${nd.nid}" (${nd.kind}): required config "${field.label}" is empty`, target: nd.nid });
      }
    }
  }

  // 6. At least one source node.
  const hasSource = def.nodes.some((n) => {
    const f = registry.get(n.kind);
    return f?.role === "source";
  });
  if (!hasSource) {
    errors.push({ code: "no_source", message: "opus has no source (trigger) node" });
  }

  return errors;
}

// ─── Compiled graph ─────────────────────────────────────────

type IncomingMap = Map<string, { from: string; fromPort: string }>;

export interface CompiledGraph {
  /** Process node ids in topological execution order (sources excluded). */
  processOrder: string[];
  /** Per-node incoming links: nid → (toPort → { from, fromPort }). */
  incomingByNode: Map<string, IncomingMap>;
  /** Per-source reachable process nodes in topo order (bi-directional BFS). */
  reachableFrom: Map<string, string[]>;
}

/**
 * Compile a validated opus definition into a pre-computed graph.
 * Runs topoSort once and pre-builds all incoming-link lookups.
 */
export function compileOpus(def: OpusDef, sourceIds: Set<string>): CompiledGraph {
  const allIds = def.nodes.map((n) => n.nid);
  const sorted = topoSort(allIds, def.links);
  const processOrder = sorted.filter((id) => !sourceIds.has(id));

  // Single pass over links: build forward adjacency + index by target node.
  // linksByTarget also serves as backward adjacency (lk.from = predecessor).
  const linksByTarget = new Map<string, typeof def.links>();
  const fwd = new Map<string, string[]>();
  for (const lk of def.links) {
    let arr = linksByTarget.get(lk.to);
    if (!arr) { arr = []; linksByTarget.set(lk.to, arr); }
    arr.push(lk);
    let f = fwd.get(lk.from);
    if (!f) { f = []; fwd.set(lk.from, f); }
    f.push(lk.to);
  }

  const incomingByNode = new Map<string, IncomingMap>();
  for (const nid of processOrder) {
    const incoming = new Map<string, { from: string; fromPort: string }>();
    for (const lk of linksByTarget.get(nid) ?? []) {
      if (incoming.has(lk.toPort)) {
        throw new Error(`BUG: duplicate link to ${nid}:${lk.toPort} — should have been caught by validation`);
      }
      incoming.set(lk.toPort, { from: lk.from, fromPort: lk.fromPort });
    }
    incomingByNode.set(nid, incoming);
  }

  // Bi-directional BFS: for each source, find all process nodes that
  // should participate in its evaluation.
  // 1) Forward BFS from source → direct downstream nodes
  // 2) Backward BFS from those → upstream dependencies (e.g. text→llm-process)
  // This ensures isolated subgraphs don't fire on unrelated source emissions.

  const reachableFrom = new Map<string, string[]>();
  for (const srcId of sourceIds) {
    // Forward: all nodes downstream of this source
    const downstream = new Set<string>();
    const fq = [srcId];
    while (fq.length) {
      const cur = fq.pop()!;
      for (const next of fwd.get(cur) ?? []) {
        if (!downstream.has(next)) { downstream.add(next); fq.push(next); }
      }
    }

    // Backward: derive predecessors from linksByTarget (lk.from = upstream node)
    const needed = new Set(downstream);
    const bq = [...downstream];
    while (bq.length) {
      const cur = bq.pop()!;
      for (const lk of linksByTarget.get(cur) ?? []) {
        if (!needed.has(lk.from) && !sourceIds.has(lk.from)) {
          needed.add(lk.from);
          bq.push(lk.from);
        }
      }
    }

    // Filter processOrder to preserve topo ordering
    reachableFrom.set(srcId, processOrder.filter((id) => needed.has(id)));
  }

  return { processOrder, incomingByNode, reachableFrom };
}

// ─── Topological sort ───────────────────────────────────────

/**
 * Kahn's algorithm.  Returns node ids in execution order.
 * Source nodes come first, then their dependents, etc.
 * Throws if the graph has a cycle (shouldn't happen after validation).
 */
function topoSort(nodeIds: string[], links: OpusLinkDef[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const lk of links) {
    adj.get(lk.from)!.push(lk.to);
    inDegree.set(lk.to, (inDegree.get(lk.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id)!) {
      const d = inDegree.get(next)! - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  if (order.length !== nodeIds.length) {
    throw new Error("cycle detected in opus graph");
  }

  return order;
}
