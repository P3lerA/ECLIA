/** Maps ConfigFieldSchema.type → PortType for connectable config fields. */
export const CFG_TO_PORT = {
  string: "string", text: "string", number: "number", boolean: "boolean",
  select: "string", model: "string",
};

/**
 * Enrich dynamic output ports with typeFromPort mirrors.
 * For each dout_X, if a matching din_X exists in inputPorts,
 * add typeFromPort: "din_X" so type inference propagates through.
 *
 * @param {import("./index").PortDef[]} inputPorts
 * @param {import("./index").PortDef[]} outputPorts
 * @returns {import("./index").PortDef[]}
 */
export function withDynamicMirrors(inputPorts, outputPorts) {
  const dinKeyList = [];
  for (const p of inputPorts) {
    if (p.key.startsWith("din_")) dinKeyList.push(p.key);
  }
  if (dinKeyList.length === 0) return outputPorts;

  const dinKeys = new Set(dinKeyList);
  return outputPorts.map((p) => {
    // "$din" sentinel → mirror from all dynamic inputs (unanimous agreement)
    if (p.typeFromPort === "$din") {
      return { ...p, typeFromPort: dinKeyList.length === 1 ? dinKeyList[0] : [...dinKeyList] };
    }
    // dout_X → din_X auto-mirror
    if (!p.key.startsWith("dout_") || p.typeFromPort) return p;
    const mirror = "din_" + p.key.slice(5);
    if (!dinKeys.has(mirror)) return p;
    return { ...p, typeFromPort: mirror };
  });
}

// ─── Shared algorithms ──────────────────────────────────────

/** @param {import("./index").PortDef} port */
function resolveStaticType(port, config) {
  if (port.typeFrom) {
    const v = String(config[port.typeFrom] ?? "");
    if (v === "string" || v === "number" || v === "boolean" || v === "object") return v;
  }
  return port.type;
}

/**
 * Resolve effective port types for all nodes in a graph.
 * Runs connection inference, forward/reverse mirror propagation,
 * and respects frozen (typeFrom) ports.
 *
 * @param {import("./index").ResolverNode[]} nodes
 * @param {import("./index").ResolverLink[]} links
 * @returns {Map<string, import("./index").PortType>}
 */
export function resolvePortTypes(nodes, links) {
  const map = new Map();
  const frozen = new Set();
  const mirrors = [];

  for (const nd of nodes) {
    for (const port of nd.inputPorts) {
      map.set(`${nd.nid}:${port.key}`, resolveStaticType(port, nd.config));
      if (port.typeFrom) frozen.add(`${nd.nid}:${port.key}`);
    }
    for (const port of nd.outputPorts) {
      map.set(`${nd.nid}:${port.key}`, resolveStaticType(port, nd.config));
      if (port.typeFrom) frozen.add(`${nd.nid}:${port.key}`);
      if (port.typeFromPort) {
        // $din sentinel is already expanded by withDynamicMirrors() before reaching here.
        const inKeys = Array.isArray(port.typeFromPort) ? port.typeFromPort : [port.typeFromPort];
        if (inKeys.length > 0) mirrors.push({ nid: nd.nid, outKey: port.key, inKeys });
      }
    }
    for (const f of nd.configSchema) {
      if (f.connectable) map.set(`${nd.nid}:cfg:${f.key}`, CFG_TO_PORT[f.type] ?? "any");
    }
  }

  // Intentional fixed cap: real Symphony graphs are expected to resolve within a
  // small number of hops, so we prefer a cheap bounded pass over a more general
  // worklist/fixed-point solver for now. If longer inference chains become a real
  // user-facing problem, replace this with a proper convergence algorithm.
  for (let i = 0; i < 10; i++) {
    let changed = false;
    // Connection inference (bidirectional)
    for (const lk of links) {
      const sKey = `${lk.from}:${lk.fromPort}`, tKey = `${lk.to}:${lk.toPort}`;
      const sType = map.get(sKey) ?? "any", tType = map.get(tKey) ?? "any";
      if (sType === "any" && tType !== "any" && !frozen.has(sKey)) { map.set(sKey, tType); changed = true; }
      else if (tType === "any" && sType !== "any" && !frozen.has(tKey)) { map.set(tKey, sType); changed = true; }
    }
    // Forward mirror: input(s) → output
    for (const { nid, outKey, inKeys } of mirrors) {
      const outKey_ = `${nid}:${outKey}`;
      if (frozen.has(outKey_)) continue;
      if ((map.get(outKey_) ?? "any") !== "any") continue;
      if (inKeys.length === 1) {
        const t = map.get(`${nid}:${inKeys[0]}`) ?? "any";
        if (t !== "any") { map.set(outKey_, t); changed = true; }
      } else {
        let unanimous = null;
        for (const k of inKeys) {
          const t = map.get(`${nid}:${k}`) ?? "any";
          if (t === "any") { unanimous = null; break; }
          if (unanimous === null) unanimous = t;
          else if (t !== unanimous) { unanimous = null; break; }
        }
        if (unanimous) { map.set(outKey_, unanimous); changed = true; }
      }
    }
    // Reverse mirror: output → input(s)
    for (const { nid, outKey, inKeys } of mirrors) {
      const outT = map.get(`${nid}:${outKey}`) ?? "any";
      if (outT === "any") continue;
      for (const k of inKeys) {
        const inKey = `${nid}:${k}`;
        if (!frozen.has(inKey) && (map.get(inKey) ?? "any") === "any") {
          map.set(inKey, outT); changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return map;
}

/**
 * Lightweight graph lint: detect unknown_kind and missing_config errors.
 * Suitable for client-side use without a server round-trip.
 *
 * @param {Array<{nid: string, kind: string, config: Record<string, unknown>}>} nodes
 * @param {Array<{to: string, toPort: string}>} links
 * @param {Map<string, import("./index").NodeKindSchema>} kindMap
 * @returns {import("./index").ValidationError[]}
 */
export function lintGraph(nodes, links, kindMap) {
  const errs = [];
  const connectedCfg = new Set();
  for (const lk of links) {
    if (lk.toPort.startsWith("cfg:")) connectedCfg.add(`${lk.to}:${lk.toPort.slice(4)}`);
  }
  for (const nd of nodes) {
    const schema = kindMap.get(nd.kind);
    if (!schema) {
      errs.push({ code: "unknown_kind", message: `unknown node kind: "${nd.kind}"`, target: nd.nid });
      continue;
    }
    for (const f of schema.configSchema) {
      if (!f.required) continue;
      const hasValue = nd.config[f.key] != null && nd.config[f.key] !== "";
      if (!hasValue && !connectedCfg.has(`${nd.nid}:${f.key}`)) {
        errs.push({ code: "missing_config", message: `node "${nd.nid}" (${nd.kind}): required config "${f.label}" is empty`, target: nd.nid });
      }
    }
  }
  return errs;
}
