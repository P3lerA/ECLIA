/**
 * Symphony — Core type definitions.
 *
 * Design principles:
 *   1. TriggerSource emits signals; it knows nothing about actions.
 *   2. ActionStep receives context and returns a result; it knows nothing about triggers.
 *   3. Instrument is the only concept that binds triggers to actions.
 *   4. Everything is a plain interface — no base classes, no inheritance tax.
 */

// ─── Config field schema ────────────────────────────────────

/**
 * Describes a single configuration field for UI form generation.
 */
export interface ConfigFieldSchema {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "text" | "model";
  required?: boolean;
  default?: unknown;
  sensitive?: boolean;
  placeholder?: string;
  /** Valid choices for "select" type. */
  options?: string[];
}

// ─── Trigger layer ───────────────────────────────────────────

/**
 * A discrete signal emitted by a trigger source.
 *
 * For event-driven sources (email, webhook), each event produces one signal.
 * For state-driven sources (battery, wifi), a signal is emitted on state change.
 */
export interface TriggerSignal<T = unknown> {
  sourceId: string;
  timestamp: number;
  data: T;
}

/**
 * A single event source.
 *
 * Implementations must be stateless between start/stop cycles.
 * Persistent state (e.g. IMAP lastUid) goes through StateAccessor.
 */
export interface TriggerSource<T = unknown> {
  readonly id: string;
  readonly kind: string;

  start(ctx: TriggerSourceContext<T>): Promise<void>;
  stop(): Promise<void>;
}

export interface TriggerSourceContext<T = unknown> {
  emit(signal: TriggerSignal<T>): void;
  state: StateAccessor;
  log: ScopedLogger;
}

/**
 * How multiple sources in a trigger group combine.
 *
 *   "any"  — fire on every signal from any source (event-driven).
 *   "all"  — fire only when the latest signal from *every* source satisfies
 *            the group (state-driven; requires all sources to have emitted).
 */
export type TriggerMode = "any" | "all";

// ─── Action layer ────────────────────────────────────────────

export interface ActionContext {
  /** The instrument this action belongs to. */
  instrumentId: string;
  /** The signal(s) that caused this fire. */
  signals: TriggerSignal[];
  /** Result of the previous step in the pipeline (undefined for the first step). */
  prev: ActionResult | undefined;
  state: StateAccessor;
  log: ScopedLogger;
}

export interface ActionResult {
  /** If false, pipeline halts (unless the step is marked optional). */
  ok: boolean;
  /** Arbitrary data passed to the next step via `ctx.prev`. */
  data?: unknown;
}

export interface ActionStep {
  readonly id: string;
  readonly kind: string;

  execute(ctx: ActionContext): Promise<ActionResult>;
}

// ─── Instrument definition (serialisable) ────────────────────

/**
 * The static, persistable description of an instrument.
 * This is what gets stored on disk / managed via API.
 */
export interface InstrumentDef {
  id: string;
  name: string;
  enabled: boolean;

  trigger: TriggerGroupDef;
  actions: ActionStepDef[];
}

export interface TriggerGroupDef {
  mode: TriggerMode;
  sources: TriggerSourceDef[];
}

export interface TriggerSourceDef {
  kind: string;
  /** Kind-specific configuration (e.g. IMAP host/port for "email-imap"). */
  config: Record<string, unknown>;
}

export interface ActionStepDef {
  kind: string;
  /** Kind-specific configuration (e.g. criterion text for "llm-triage"). */
  config: Record<string, unknown>;
}

// ─── Factory contracts ───────────────────────────────────────

export interface TriggerSourceFactory<T = unknown> {
  readonly kind: string;
  readonly label?: string;
  readonly configSchema?: ConfigFieldSchema[];
  create(id: string, config: Record<string, unknown>): TriggerSource<T>;
}

export interface ActionStepFactory {
  readonly kind: string;
  readonly label?: string;
  readonly configSchema?: ConfigFieldSchema[];
  create(id: string, config: Record<string, unknown>): ActionStep;
}

// ─── Presets ─────────────────────────────────────────────────

/**
 * A preset bundles a fixed trigger/action structure.
 * The user only supplies the variable parts (credentials, rules, targets).
 */
/**
 * A preset is metadata-only: it tells the UI which trigger/action kinds
 * to pre-select and what extra config fields to show.  No scaffold logic.
 */
export interface InstrumentPreset {
  readonly presetId: string;
  readonly name: string;
  readonly description: string;
  /** The trigger kind(s) this preset uses. */
  readonly triggerKinds: string[];
  /** The action kind(s) this preset uses, in pipeline order. */
  readonly actionKinds: string[];
  /** Extra config fields shown in the UI (merged into last action config). */
  readonly configSchema?: ConfigFieldSchema[];
}

// ─── Shared services ─────────────────────────────────────────

export interface StateAccessor {
  get<V = unknown>(key: string): Promise<V | undefined>;
  set<V = unknown>(key: string, value: V): Promise<void>;
}

export interface ScopedLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
