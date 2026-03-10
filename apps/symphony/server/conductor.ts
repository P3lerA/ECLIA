import type { OpusDef, OpusStatus, ValidationError, EvaluationRecord, ScopedLogger } from "./types.js";
import { Registry } from "./registry.js";
import { StateStore } from "./state-store.js";
import { OpusStore } from "./opus-store.js";
import { OpusRuntime } from "./opus-runtime.js";
import { validateOpus, OpusValidationError } from "./graph.js";

export class Conductor {
  readonly registry: Registry;
  private gatewayUrl: string;
  private stateStore: StateStore;
  private opusStore: OpusStore;

  private runtimes = new Map<string, OpusRuntime>();
  /** Defs that failed to instantiate — visible in list() so users can fix/delete. */
  private failedDefs = new Map<string, OpusDef>();
  private makeLogger: (opusId: string) => ScopedLogger;
  private onEvaluationComplete?: (record: EvaluationRecord) => void;

  constructor(opts: {
    registry: Registry;
    gatewayUrl: string;
    stateStore: StateStore;
    opusStore: OpusStore;
    makeLogger: (opusId: string) => ScopedLogger;
    onEvaluationComplete?: (record: EvaluationRecord) => void;
  }) {
    this.registry = opts.registry;
    this.gatewayUrl = opts.gatewayUrl;
    this.stateStore = opts.stateStore;
    this.opusStore = opts.opusStore;
    this.makeLogger = opts.makeLogger;
    this.onEvaluationComplete = opts.onEvaluationComplete;
  }

  // ── Bootstrap ──────────────────────────────────────────────

  /** Load all persisted opus definitions and start the enabled ones. */
  async bootstrap(): Promise<void> {
    const defs = await this.opusStore.loadAll();
    for (const def of defs) {
      try {
        this.instantiate(def);
      } catch (e: any) {
        this.makeLogger(def.id).error("failed to load opus:", String(e?.message ?? e));
        this.failedDefs.set(def.id, def);
      }
    }
    await this.startAllEnabled();
  }

  // ── Validation ─────────────────────────────────────────────

  validate(def: OpusDef): ValidationError[] {
    return validateOpus(def, this.registry);
  }

  // ── Opus CRUD ──────────────────────────────────────────────

  /** Persist an opus without restarting its runtime. */
  async save(def: OpusDef): Promise<void> {
    this.failedDefs.delete(def.id);
    if (!this.runtimes.has(def.id)) {
      try {
        this.instantiate(def);
      } catch {
        // Still broken — keep in failedDefs so it stays visible.
        this.failedDefs.set(def.id, def);
      }
    } else {
      this.runtimes.get(def.id)!.def = def;
    }
    await this.opusStore.save(def);
  }

  /** Tear down and re-instantiate an opus, restarting if enabled. */
  async reload(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error(`opus not found: "${id}"`);
    const def = rt.def;

    await rt.stop();
    this.instantiate(def);

    if (def.enabled) {
      await this.runtimes.get(id)!.start();
    }
  }

  /** Create or replace an opus. Always persists; never validates. */
  async upsert(def: OpusDef): Promise<void> {
    // Tear down existing runtime if present.
    const old = this.runtimes.get(def.id);
    if (old) await old.stop();

    this.instantiate(def);
    await this.opusStore.save(def);

    if (def.enabled) {
      await this.runtimes.get(def.id)!.start();
    }
  }

  /** Toggle enabled state. Validates before starting. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error(`opus not found: "${id}"`);
    const def = { ...rt.def, enabled };

    if (enabled) {
      const errors = this.validate(def);
      if (errors.length) throw new OpusValidationError(errors);
    }

    await this.upsert(def);
  }

  async remove(id: string): Promise<void> {
    this.failedDefs.delete(id);
    const rt = this.runtimes.get(id);
    if (rt) await rt.stop();
    this.runtimes.delete(id);
    await this.stateStore.clear(id);
    await this.opusStore.remove(id);
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async startAllEnabled(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [id, rt] of this.runtimes) {
      if (rt.def.enabled) {
        const errors = this.validate(rt.def);
        if (errors.length) {
          this.makeLogger(id).error("validation failed, not starting:", errors.map((e) => e.message).join("; "));
          rt.markError();
          rt.def = { ...rt.def, enabled: false };
          await this.opusStore.save(rt.def);
          continue;
        }
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
    await Promise.allSettled([...this.runtimes.values()].map((rt) => rt.stop()));
  }

  // ── Introspection ──────────────────────────────────────────

  list(): Array<OpusDef & { status: OpusStatus }> {
    const results: Array<OpusDef & { status: OpusStatus }> = [];
    for (const rt of this.runtimes.values()) {
      results.push({ ...rt.def, status: rt.getStatus() });
    }
    for (const def of this.failedDefs.values()) {
      results.push({ ...def, status: "error" });
    }
    return results;
  }

  get(id: string): OpusRuntime | undefined {
    return this.runtimes.get(id);
  }

  /** Get the raw def for a failed opus (no runtime). */
  getFailedDef(id: string): OpusDef | undefined {
    return this.failedDefs.get(id);
  }

  // ── Internal ───────────────────────────────────────────────

  private instantiate(def: OpusDef): void {
    const rt = new OpusRuntime(
      def,
      this.registry,
      this.stateStore.scope(def.id),
      this.makeLogger(def.id),
      { gatewayUrl: this.gatewayUrl, opusId: def.id }
    );
    rt.onEvaluationComplete = this.onEvaluationComplete;
    this.runtimes.set(def.id, rt);
  }
}
