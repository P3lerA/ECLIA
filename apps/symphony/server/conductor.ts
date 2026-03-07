import type { InstrumentDef, InstrumentPreset, ScopedLogger } from "./types.js";
import { Registry } from "./registry.js";
import { StateStore } from "./state-store.js";
import { InstrumentRuntime, type InstrumentStatus } from "./instrument-runtime.js";

export interface InstrumentInfo {
  id: string;
  name: string;
  enabled: boolean;
  status: InstrumentStatus;
}

/**
 * The Conductor manages the full lifecycle of instruments.
 *
 * Responsibilities:
 *   - Hold the Registry (trigger/action factories) and StateStore.
 *   - Instantiate InstrumentRuntimes from InstrumentDefs.
 *   - Start / stop / restart individual instruments.
 *   - Expose a read-only view for future API routes.
 */
export class Conductor {
  readonly registry: Registry;
  readonly stateStore: StateStore;

  private instruments = new Map<string, InstrumentRuntime>();
  private presets = new Map<string, InstrumentPreset>();
  private makeLogger: (instrumentId: string) => ScopedLogger;

  constructor(opts: {
    registry: Registry;
    stateStore: StateStore;
    makeLogger: (instrumentId: string) => ScopedLogger;
  }) {
    this.registry = opts.registry;
    this.stateStore = opts.stateStore;
    this.makeLogger = opts.makeLogger;
  }

  // ── Preset management ──────────────────────────────────────

  registerPreset(preset: InstrumentPreset): void {
    this.presets.set(preset.presetId, preset);
  }

  getPreset(presetId: string): InstrumentPreset | undefined {
    return this.presets.get(presetId);
  }

  listPresets(): InstrumentPreset[] {
    return [...this.presets.values()];
  }

  // ── Instrument CRUD ────────────────────────────────────────

  /**
   * Add an instrument from a raw definition.
   * Does NOT auto-start; call `start(id)` explicitly.
   */
  add(def: InstrumentDef): void {
    if (this.instruments.has(def.id)) {
      throw new Error(`instrument already exists: "${def.id}"`);
    }
    const rt = new InstrumentRuntime(
      def,
      this.registry,
      this.stateStore.scope(def.id),
      this.makeLogger(def.id)
    );
    this.instruments.set(def.id, rt);
  }

  /**
   * Replace an instrument's definition (typically after config edits).
   * Stops the old runtime, swaps in a new one, restarts if it was running.
   */
  async update(id: string, newDef: InstrumentDef): Promise<void> {
    const rt = this.instruments.get(id);
    if (!rt) throw new Error(`instrument not found: "${id}"`);

    const wasRunning = rt.getStatus() === "running";
    await rt.stop();
    this.instruments.delete(id);

    const newRt = new InstrumentRuntime(
      newDef,
      this.registry,
      this.stateStore.scope(id),
      this.makeLogger(id)
    );
    this.instruments.set(id, newRt);

    if (wasRunning && newDef.enabled) {
      await newRt.start();
    }
  }

  async remove(id: string): Promise<void> {
    const rt = this.instruments.get(id);
    if (!rt) return;
    await rt.stop();
    await this.stateStore.clear(id);
    this.instruments.delete(id);
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async start(id: string): Promise<void> {
    const rt = this.instruments.get(id);
    if (!rt) throw new Error(`instrument not found: "${id}"`);
    await rt.start();
  }

  async stop(id: string): Promise<void> {
    const rt = this.instruments.get(id);
    if (!rt) throw new Error(`instrument not found: "${id}"`);
    await rt.stop();
  }

  /** Start all instruments that have `enabled: true`. */
  async startAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [id, rt] of this.instruments) {
      if (rt.def.enabled) {
        tasks.push(
          rt.start().catch((e) => {
            // Don't let one failing instrument prevent others from starting.
            this.makeLogger(id).error("failed to start:", String(e?.message ?? e));
          })
        );
      }
    }
    await Promise.allSettled(tasks);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(
      [...this.instruments.values()].map((rt) => rt.stop())
    );
  }

  // ── Introspection ──────────────────────────────────────────

  list(): InstrumentInfo[] {
    return [...this.instruments.values()].map((rt) => ({
      id: rt.def.id,
      name: rt.def.name,
      enabled: rt.def.enabled,
      status: rt.getStatus()
    }));
  }

  get(id: string): InstrumentRuntime | undefined {
    return this.instruments.get(id);
  }
}
