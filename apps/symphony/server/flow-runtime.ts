import type {
  FlowDef,
  FlowStatus,
  Node,
  SourceNode,
  ProcessNode,
  NodeOutputs,
  SourceNodeContext,
  NodeContext,
  StateAccessor,
  ScopedLogger
} from "./types.js";
import type { Registry } from "./registry.js";
import { compileFlow, type CompiledGraph } from "./graph.js";

/**
 * A live instance of a flow.
 *
 * Owns all node instances.  Source nodes emit asynchronously;
 * each emission triggers a synchronous (queued) graph evaluation
 * over the downstream process nodes.
 */
export class FlowRuntime {
  readonly def: FlowDef;
  private status: FlowStatus = "stopped";
  private log: ScopedLogger;
  private state: StateAccessor;
  private abortCtrl = new AbortController();

  /** All instantiated nodes, keyed by nid. */
  private nodes = new Map<string, Node>();
  /** Source nodes (subset of this.nodes). */
  private sources: SourceNode[] = [];
  /** Pre-compiled graph topology. */
  private graph: CompiledGraph;

  /** Serialise graph runs so emissions don't interleave. */
  private runQueue: Promise<void> = Promise.resolve();

  constructor(
    def: FlowDef,
    registry: Registry,
    state: StateAccessor,
    log: ScopedLogger
  ) {
    this.def = def;
    this.state = state;
    this.log = log;

    // Instantiate every node.
    for (const nd of def.nodes) {
      const node = registry.create(nd.kind, nd.nid, nd.config);
      this.nodes.set(nd.nid, node);
      if (node.role === "source") {
        this.sources.push(node as SourceNode);
      }
    }

    // Compile graph topology once.
    const sourceIds = new Set(this.sources.map((s) => s.id));
    this.graph = compileFlow(def, sourceIds);
  }

  getStatus(): FlowStatus {
    return this.status;
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
          state: this.scopedState(src.id),
          log: this.log,
          signal: this.abortCtrl.signal
        };
        await src.start(ctx);
      }
      this.status = "running";
      this.log.info(`flow started (${this.sources.length} source(s), ${this.graph.processOrder.length} process node(s))`);
    } catch (e: any) {
      this.status = "error";
      this.log.error("flow start failed:", String(e?.message ?? e));
      await this.stopSources();
      throw e;
    }
  }

  async stop(): Promise<void> {
    if (this.status === "stopped") return;
    this.abortCtrl.abort();
    await this.stopSources();
    this.status = "stopped";
    this.log.info("flow stopped");
  }

  // ── Graph evaluation ───────────────────────────────────────

  private onSourceEmit(sourceId: string, outputs: NodeOutputs): void {
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
    /** Accumulated outputs per node: nid → { portKey → value }. */
    const resolved = new Map<string, NodeOutputs>();
    resolved.set(sourceId, sourceOutputs);

    /** Nodes whose output was null (halted). */
    const halted = new Set<string>();

    for (const nid of this.graph.processOrder) {
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

      // Only execute if at least one input was actually provided
      // (avoids executing nodes in unrelated branches).
      if (incoming.size > 0 && Object.keys(inputs).length === 0) continue;

      const ctx: NodeContext = {
        inputs,
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
        }
      } catch (e: any) {
        this.log.error(`node "${nid}" (${node.kind}) threw:`, String(e?.message ?? e));
        halted.add(nid);
      }
    }
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
