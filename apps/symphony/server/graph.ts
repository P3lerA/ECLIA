import type { FlowDef, FlowLinkDef, ValidationError } from "./types.js";
import type { Registry } from "./registry.js";

// ─── Validation ─────────────────────────────────────────────

export class FlowValidationError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(`invalid flow: ${errors.map((e) => e.message).join("; ")}`);
    this.errors = errors;
  }
}

/**
 * Validate a flow definition against the registry.
 * Returns an empty array if the flow is valid.
 */
export function validateFlow(flow: FlowDef, registry: Registry): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeMap = new Map(flow.nodes.map((n) => [n.nid, n]));

  // 1. Every node kind must exist in the registry.
  for (const nd of flow.nodes) {
    if (!registry.get(nd.kind)) {
      errors.push({ code: "unknown_kind", message: `unknown node kind: "${nd.kind}"`, target: nd.nid });
    }
  }

  // 2. Links reference valid nodes and ports.
  for (const lk of flow.links) {
    if (!nodeMap.has(lk.from)) {
      errors.push({ code: "bad_link_source", message: `link "${lk.lid}" references unknown source node "${lk.from}"`, target: lk.lid });
    }
    if (!nodeMap.has(lk.to)) {
      errors.push({ code: "bad_link_target", message: `link "${lk.lid}" references unknown target node "${lk.to}"`, target: lk.lid });
    }
    // Port existence checked only if both kinds are known.
    const fromNode = nodeMap.get(lk.from);
    const toNode = nodeMap.get(lk.to);
    if (fromNode && toNode) {
      const ff = registry.get(fromNode.kind);
      const tf = registry.get(toNode.kind);
      if (ff && !ff.outputPorts.some((p) => p.key === lk.fromPort)) {
        errors.push({ code: "bad_output_port", message: `node "${lk.from}" (${fromNode.kind}) has no output port "${lk.fromPort}"`, target: lk.lid });
      }
      if (tf && !tf.inputPorts.some((p) => p.key === lk.toPort)) {
        errors.push({ code: "bad_input_port", message: `node "${lk.to}" (${toNode.kind}) has no input port "${lk.toPort}"`, target: lk.lid });
      }
    }
  }

  // 3. No duplicate links to the same input port.
  const seenInputs = new Set<string>();
  for (const lk of flow.links) {
    const key = `${lk.to}:${lk.toPort}`;
    if (seenInputs.has(key)) {
      const node = nodeMap.get(lk.to);
      errors.push({ code: "duplicate_input", message: `input port "${lk.toPort}" on node "${lk.to}" (${node?.kind ?? "?"}) has multiple incoming links`, target: lk.lid });
    }
    seenInputs.add(key);
  }

  // 4. No cycles.
  try {
    topoSort([...nodeMap.keys()], flow.links);
  } catch {
    errors.push({ code: "cycle", message: "flow contains a cycle" });
  }

  // 5. At least one source node.
  const hasSource = flow.nodes.some((n) => {
    const f = registry.get(n.kind);
    return f?.role === "source";
  });
  if (!hasSource) {
    errors.push({ code: "no_source", message: "flow has no source (trigger) node" });
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
}

/**
 * Compile a validated flow definition into a pre-computed graph.
 * Runs topoSort once and pre-builds all incoming-link lookups.
 */
export function compileFlow(def: FlowDef, sourceIds: Set<string>): CompiledGraph {
  const allIds = def.nodes.map((n) => n.nid);
  const sorted = topoSort(allIds, def.links);
  const processOrder = sorted.filter((id) => !sourceIds.has(id));

  const incomingByNode = new Map<string, IncomingMap>();
  for (const nid of processOrder) {
    const incoming = new Map<string, { from: string; fromPort: string }>();
    for (const lk of def.links) {
      if (lk.to === nid) {
        if (incoming.has(lk.toPort)) {
          throw new Error(`BUG: duplicate link to ${nid}:${lk.toPort} — should have been caught by validation`);
        }
        incoming.set(lk.toPort, { from: lk.from, fromPort: lk.fromPort });
      }
    }
    incomingByNode.set(nid, incoming);
  }

  return { processOrder, incomingByNode };
}

// ─── Topological sort ───────────────────────────────────────

/**
 * Kahn's algorithm.  Returns node ids in execution order.
 * Source nodes come first, then their dependents, etc.
 * Throws if the graph has a cycle (shouldn't happen after validation).
 */
function topoSort(nodeIds: string[], links: FlowLinkDef[]): string[] {
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
    throw new Error("cycle detected in flow graph");
  }

  return order;
}
