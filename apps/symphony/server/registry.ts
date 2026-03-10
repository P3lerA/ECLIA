import type { NodeFactory, Node, NodeKindSchema, PortDef } from "./types.js";

/**
 * Central registry for node factories.
 *
 * Built-in kinds are registered at boot.
 * Plugins can add more via `register()`.
 */
export class Registry {
  private factories = new Map<string, NodeFactory>();

  register(factory: NodeFactory): void {
    if (this.factories.has(factory.kind)) {
      throw new Error(`duplicate node kind: "${factory.kind}"`);
    }
    this.factories.set(factory.kind, factory);
  }

  get(kind: string): NodeFactory | undefined {
    return this.factories.get(kind);
  }

  create(kind: string, id: string, config: Record<string, unknown>, dynamicPorts?: { inputs?: PortDef[], outputs?: PortDef[] }): Node {
    const f = this.factories.get(kind);
    if (!f) throw new Error(`unknown node kind: "${kind}"`);
    return f.create(id, config, dynamicPorts);
  }

  /** All registered kinds, for the API / UI. */
  schemas(): NodeKindSchema[] {
    return [...this.factories.values()].map((f) => ({
      kind: f.kind,
      label: f.label,
      role: f.role,
      description: f.description,
      inputPorts: f.inputPorts,
      outputPorts: f.outputPorts,
      configSchema: f.configSchema,
      ...(f.dynamicInput && { dynamicInput: f.dynamicInput }),
      ...(f.dynamicOutput && { dynamicOutput: f.dynamicOutput }),
    }));
  }
}
