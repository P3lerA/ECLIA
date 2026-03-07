import type {
  InstrumentDef,
  TriggerSource,
  TriggerSignal,
  TriggerSourceContext,
  ActionStep,
  ActionContext,
  ActionResult,
  StateAccessor,
  ScopedLogger
} from "./types.js";
import type { Registry } from "./registry.js";

export type InstrumentStatus = "stopped" | "starting" | "running" | "error";

/**
 * A live instance of an instrument.
 *
 * Owns the trigger sources and action steps; manages the
 * fire → pipeline lifecycle.
 */
export class InstrumentRuntime {
  readonly def: InstrumentDef;

  private sources: TriggerSource[] = [];
  private steps: ActionStep[] = [];
  private status: InstrumentStatus = "stopped";
  private log: ScopedLogger;
  private state: StateAccessor;

  /**
   * For mode="all": latest signal from each source, keyed by source id.
   * A fire happens only when every source has a signal present.
   */
  private latest = new Map<string, TriggerSignal>();

  /** Serialise pipeline runs so we don't overlap on the same instrument. */
  private runQueue: Promise<void> = Promise.resolve();

  constructor(
    def: InstrumentDef,
    registry: Registry,
    state: StateAccessor,
    log: ScopedLogger
  ) {
    this.def = def;
    this.state = state;
    this.log = log;

    // Materialise sources.
    for (let i = 0; i < def.trigger.sources.length; i++) {
      const sd = def.trigger.sources[i];
      const id = `${def.id}:trigger:${i}`;
      this.sources.push(registry.createTrigger(sd.kind, id, sd.config));
    }

    // Materialise steps.
    for (let i = 0; i < def.actions.length; i++) {
      const ad = def.actions[i];
      const id = `${def.id}:action:${i}`;
      this.steps.push(registry.createAction(ad.kind, id, ad.config));
    }
  }

  getStatus(): InstrumentStatus {
    return this.status;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") return;
    this.status = "starting";
    this.latest.clear();

    try {
      for (const src of this.sources) {
        const ctx: TriggerSourceContext = {
          emit: (signal) => this.onSignal(signal),
          state: this.state,
          log: this.log
        };
        await src.start(ctx);
      }
      this.status = "running";
      this.log.info(`started (${this.sources.length} source(s), ${this.steps.length} action(s))`);
    } catch (e: any) {
      this.status = "error";
      this.log.error("start failed:", String(e?.message ?? e));
      // Best-effort stop any sources that did start.
      await this.stopSources();
      throw e;
    }
  }

  async stop(): Promise<void> {
    if (this.status === "stopped") return;
    await this.stopSources();
    this.status = "stopped";
    this.log.info("stopped");
  }

  // ── Trigger composition ────────────────────────────────────

  private onSignal(signal: TriggerSignal): void {
    const mode = this.def.trigger.mode;

    if (mode === "any") {
      this.enqueuePipeline([signal]);
      return;
    }

    // mode === "all"
    this.latest.set(signal.sourceId, signal);
    if (this.latest.size >= this.sources.length) {
      const signals = [...this.latest.values()];
      this.latest.clear();
      this.enqueuePipeline(signals);
    }
  }

  // ── Action pipeline ────────────────────────────────────────

  private enqueuePipeline(signals: TriggerSignal[]): void {
    this.runQueue = this.runQueue
      .then(() => this.runPipeline(signals))
      .catch((e) => {
        this.log.error("pipeline error:", String(e?.message ?? e));
      });
  }

  private async runPipeline(signals: TriggerSignal[]): Promise<void> {
    let prev: ActionResult | undefined;

    for (const step of this.steps) {
      const ctx: ActionContext = {
        instrumentId: this.def.id,
        signals,
        prev,
        state: this.state,
        log: this.log
      };

      try {
        prev = await step.execute(ctx);
        if (!prev.ok) {
          this.log.warn(`step "${step.id}" (${step.kind}) returned ok=false — halting pipeline`);
          return;
        }
      } catch (e: any) {
        this.log.error(`step "${step.id}" (${step.kind}) threw:`, String(e?.message ?? e));
        return;
      }
    }
  }

  // ── Internal ───────────────────────────────────────────────

  private async stopSources(): Promise<void> {
    await Promise.allSettled(this.sources.map((s) => s.stop()));
  }
}
