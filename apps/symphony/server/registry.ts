import type { TriggerSourceFactory, ActionStepFactory, TriggerSource, ActionStep, ConfigFieldSchema } from "./types.js";

export interface KindSchema {
  kind: string;
  label: string;
  configSchema: ConfigFieldSchema[];
}

/**
 * Central registry for trigger source and action step factories.
 *
 * Built-in kinds are registered at boot; user-defined kinds can be
 * loaded from custom modules later (the "skill" path).
 */
export class Registry {
  private triggers = new Map<string, TriggerSourceFactory>();
  private actions = new Map<string, ActionStepFactory>();

  // ── Registration ───────────────────────────────────────────

  registerTrigger(factory: TriggerSourceFactory): void {
    if (this.triggers.has(factory.kind)) {
      throw new Error(`duplicate trigger kind: "${factory.kind}"`);
    }
    this.triggers.set(factory.kind, factory);
  }

  registerAction(factory: ActionStepFactory): void {
    if (this.actions.has(factory.kind)) {
      throw new Error(`duplicate action kind: "${factory.kind}"`);
    }
    this.actions.set(factory.kind, factory);
  }

  // ── Instantiation ──────────────────────────────────────────

  createTrigger(kind: string, id: string, config: Record<string, unknown>): TriggerSource {
    const f = this.triggers.get(kind);
    if (!f) throw new Error(`unknown trigger kind: "${kind}"`);
    return f.create(id, config);
  }

  createAction(kind: string, id: string, config: Record<string, unknown>): ActionStep {
    const f = this.actions.get(kind);
    if (!f) throw new Error(`unknown action kind: "${kind}"`);
    return f.create(id, config);
  }

  // ── Introspection ──────────────────────────────────────────

  triggerSchemas(): KindSchema[] {
    return [...this.triggers.values()].map((f) => ({
      kind: f.kind,
      label: f.label ?? f.kind,
      configSchema: f.configSchema ?? []
    }));
  }

  actionSchemas(): KindSchema[] {
    return [...this.actions.values()].map((f) => ({
      kind: f.kind,
      label: f.label ?? f.kind,
      configSchema: f.configSchema ?? []
    }));
  }
}
