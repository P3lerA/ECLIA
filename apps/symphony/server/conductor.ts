import type { FlowDef, FlowStatus, ValidationError, ScopedLogger } from "./types.js";
import { Registry } from "./registry.js";
import { StateStore } from "./state-store.js";
import { FlowStore } from "./flow-store.js";
import { FlowRuntime } from "./flow-runtime.js";
import { validateFlow, FlowValidationError } from "./graph.js";

export interface FlowInfo {
  id: string;
  name: string;
  enabled: boolean;
  status: FlowStatus;
}

export class Conductor {
  readonly registry: Registry;
  private stateStore: StateStore;
  private flowStore: FlowStore;

  private flows = new Map<string, FlowRuntime>();
  private makeLogger: (flowId: string) => ScopedLogger;

  constructor(opts: {
    registry: Registry;
    stateStore: StateStore;
    flowStore: FlowStore;
    makeLogger: (flowId: string) => ScopedLogger;
  }) {
    this.registry = opts.registry;
    this.stateStore = opts.stateStore;
    this.flowStore = opts.flowStore;
    this.makeLogger = opts.makeLogger;
  }

  // ── Bootstrap ──────────────────────────────────────────────

  /** Load all persisted flows and start the enabled ones. */
  async bootstrap(): Promise<void> {
    const defs = await this.flowStore.loadAll();
    for (const def of defs) {
      try {
        this.instantiate(def);
      } catch (e: any) {
        this.makeLogger(def.id).error("failed to load flow:", String(e?.message ?? e));
      }
    }
    await this.startAllEnabled();
  }

  // ── Validation ─────────────────────────────────────────────

  validate(def: FlowDef): ValidationError[] {
    return validateFlow(def, this.registry);
  }

  // ── Flow CRUD ──────────────────────────────────────────────

  /** Create or replace a flow. Validates, persists, and manages lifecycle. */
  async upsert(def: FlowDef): Promise<void> {
    const errors = this.validate(def);
    if (errors.length) {
      throw new FlowValidationError(errors);
    }

    // Tear down existing runtime if present.
    const old = this.flows.get(def.id);
    if (old) await old.stop();

    this.instantiate(def);
    await this.flowStore.save(def);

    if (def.enabled) {
      await this.flows.get(def.id)!.start();
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const rt = this.flows.get(id);
    if (!rt) throw new Error(`flow not found: "${id}"`);
    await this.upsert({ ...rt.def, enabled });
  }

  async remove(id: string): Promise<void> {
    const rt = this.flows.get(id);
    if (rt) await rt.stop();
    this.flows.delete(id);
    await this.stateStore.clear(id);
    await this.flowStore.remove(id);
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async startAllEnabled(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [id, rt] of this.flows) {
      if (rt.def.enabled) {
        tasks.push(
          rt.start().catch((e) => {
            this.makeLogger(id).error("failed to start:", String(e?.message ?? e));
          })
        );
      }
    }
    await Promise.allSettled(tasks);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.flows.values()].map((rt) => rt.stop()));
  }

  // ── Introspection ──────────────────────────────────────────

  list(): FlowInfo[] {
    return [...this.flows.values()].map((rt) => ({
      id: rt.def.id,
      name: rt.def.name,
      enabled: rt.def.enabled,
      status: rt.getStatus()
    }));
  }

  get(id: string): FlowRuntime | undefined {
    return this.flows.get(id);
  }

  // ── Internal ───────────────────────────────────────────────

  private instantiate(def: FlowDef): void {
    const rt = new FlowRuntime(
      def,
      this.registry,
      this.stateStore.scope(def.id),
      this.makeLogger(def.id)
    );
    this.flows.set(def.id, rt);
  }
}
