import type {
  OpusDef,
  OpusStatus,
  Node,
  SourceNode,
  ProcessNode,
  NodeOutputs,
  RuntimeServices,
  SourceNodeContext,
  NodeContext,
  StateAccessor,
  ScopedLogger,
  EvaluationRecord
} from "./types.js";
import type { Registry } from "./registry.js";
import { compileOpus, type CompiledGraph } from "./graph.js";

/**
 * A live instance of an opus.
 *
 * Owns all node instances.  Source nodes emit asynchronously;
 * each emission triggers a synchronous (queued) graph evaluation
 * over the downstream process nodes.
 */
export class OpusRuntime {
  def: OpusDef;
  private status: OpusStatus = "stopped";
  private services: RuntimeServices;
  private log: ScopedLogger;
  private state: StateAccessor;
  private abortCtrl = new AbortController();

  /** All instantiated nodes, keyed by nid. */
  private nodes = new Map<string, Node>();
  /** Mutable config refs per node (same object the node factory closed over). */
  private configs = new Map<string, Record<string, unknown>>();
  /** Source nodes (subset of this.nodes). */
  private sources: SourceNode[] = [];
  /** Pre-compiled graph topology. */
  private graph: CompiledGraph;
  /** Serialise graph runs so emissions don't interleave. */
  private runQueue: Promise<void> = Promise.resolve();

  /** Optional hook called after each graph evaluation completes. */
  onEvaluationComplete?: (record: EvaluationRecord) => void;

  constructor(
    def: OpusDef,
    registry: Registry,
    state: StateAccessor,
    log: ScopedLogger,
    services: RuntimeServices
  ) {
    this.def = def;
    this.services = services;
    this.state = state;
    this.log = log;

    // Instantiate every node.
    // Clone config so cfg: wire overrides don't leak back into def.
    for (const nd of def.nodes) {
      const config = structuredClone(nd.config);
      const node = registry.create(nd.kind, nd.nid, config);
      this.nodes.set(nd.nid, node);
      this.configs.set(nd.nid, config);
      if (node.role === "source") {
        this.sources.push(node as SourceNode);
      }
    }

    // Compile graph topology once.
    const sourceIds = new Set(this.sources.map((s) => s.id));
    this.graph = compileOpus(def, sourceIds);
  }

  getStatus(): OpusStatus {
    return this.status;
  }

  /** Set status to "error" without attempting to start (e.g. validation failure). */
  markError(): void {
    this.status = "error";
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") return;
    this.status = "starting";
    this.abortCtrl = new AbortController();

    try {
      for (const src of this.sources) {
        const ctx: SourceNodeContext = {
          emit: (outputs) => this.onSourceEmit(src.id, outputs),
          services: this.services,
          state: this.scopedState(src.id),
          log: this.log,
          signal: this.abortCtrl.signal
        };
        await src.start(ctx);
      }
      this.status = "running";
      this.log.info(`opus started (${this.sources.length} source(s), ${this.graph.processOrder.length} process node(s))`);
    } catch (e: any) {
      this.status = "error";
      this.log.error("opus start failed:", String(e?.message ?? e));
      await this.stopSources();
      throw e;
    }
  }

  async stop(): Promise<void> {
    if (this.status === "stopped") return;
    this.abortCtrl.abort();
    await this.stopSources();
    this.status = "stopped";
    this.log.info("opus stopped");
  }

  // ── Graph evaluation ───────────────────────────────────────

  private onSourceEmit(sourceId: string, outputs: NodeOutputs): void {
    if (this.status !== "running") return;
    this.runQueue = this.runQueue
      .then(() => this.evaluate(sourceId, outputs))
      .catch((e) => {
        this.log.error(`graph evaluation error (source=${sourceId}):`, String(e?.message ?? e));
      });
  }

  /**
   * Evaluate the graph starting from a source emission.
   *
   * Walk the process nodes in topo order.  For each node, gather its
   * input port values from the outputs of upstream nodes (resolved via
   * links), then execute.  If a node returns null, its downstream
   * dependents are skipped (propagation halt).
   */
  private async evaluate(sourceId: string, sourceOutputs: NodeOutputs): Promise<void> {
    const t0 = Date.now();
    /** Accumulated outputs per node: nid → { portKey → value }. */
    const resolved = new Map<string, NodeOutputs>();
    resolved.set(sourceId, sourceOutputs);

    /** Nodes whose output was null (halted). */
    const halted = new Set<string>();
    const nodesRun: string[] = [];
    let evalError: string | undefined;

    const scope = this.graph.reachableFrom.get(sourceId) ?? this.graph.processOrder;
    for (const nid of scope) {
      const node = this.nodes.get(nid) as ProcessNode | undefined;
      if (!node) continue;

      // Gather inputs from pre-compiled incoming links.
      const incoming = this.graph.incomingByNode.get(nid)!;
      const inputs: Record<string, unknown> = {};
      let skip = false;

      for (const [toPort, { from, fromPort }] of incoming) {
        // If any required upstream halted, skip this node.
        if (halted.has(from)) { skip = true; break; }

        const upstreamOut = resolved.get(from);
        if (upstreamOut !== undefined) {
          inputs[toPort] = upstreamOut[fromPort];
        }
        // If upstream hasn't been resolved at all (disconnected branch
        // from a different source), leave the input undefined.
      }

      if (skip) {
        halted.add(nid);
        continue;
      }

      // Separate cfg: inputs — temporarily override config for this execution only.
      const config = this.configs.get(nid);
      const savedCfg: [string, unknown][] = [];
      for (const key of Object.keys(inputs)) {
        if (key.startsWith("cfg:") && config) {
          const cfgKey = key.slice(4);
          savedCfg.push([cfgKey, config[cfgKey]]);
          config[cfgKey] = inputs[key];
          delete inputs[key];
        }
      }

      const ctx: NodeContext = {
        inputs,
        services: this.services,
        state: this.scopedState(nid),
        log: this.log,
        signal: this.abortCtrl.signal
      };

      try {
        const result = await node.execute(ctx);
        if (result === null) {
          halted.add(nid);
          this.log.info(`node "${nid}" (${node.kind}) halted propagation`);
        } else {
          resolved.set(nid, result);
          nodesRun.push(nid);
        }
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        this.log.error(`node "${nid}" (${node.kind}) threw:`, msg);
        halted.add(nid);
        evalError ??= `${nid}: ${msg}`;
      } finally {
        // Restore config to base values so cfg: overrides don't leak across evaluations.
        if (config) {
          for (const [k, v] of savedCfg) config[k] = v;
        }
      }
    }

    this.onEvaluationComplete?.({
      opusId: this.def.id,
      sourceId,
      timestamp: t0,
      durationMs: Date.now() - t0,
      nodesRun,
      nodesHalted: [...halted],
      error: evalError,
    });
  }

  // ── External trigger ─────────────────────────────────────────

  /**
   * Fire a manual-trigger source node from outside the runtime.
   * Throws if the node doesn't exist, isn't a source, or isn't triggerable.
   */
  triggerNode(nid: string, payload: unknown): void {
    const node = this.nodes.get(nid);
    if (!node) throw new Error(`node "${nid}" not found`);
    if (node.role !== "source") throw new Error(`node "${nid}" is not a source`);
    if (typeof (node as any).trigger !== "function") {
      throw new Error(`node "${nid}" (${node.kind}) does not support external triggering`);
    }
    (node as any).trigger(payload);
  }

  // ── Internal ───────────────────────────────────────────────

  private scopedState(nid: string): StateAccessor {
    const prefix = `${nid}:`;
    return {
      get: <V>(key: string) => this.state.get<V>(prefix + key),
      set: <V>(key: string, value: V) => this.state.set(prefix + key, value)
    };
  }

  private async stopSources(): Promise<void> {
    await Promise.allSettled(this.sources.map((s) => s.stop()));
  }
}
