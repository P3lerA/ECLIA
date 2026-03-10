/**
 * boolean — Transform node.
 *
 * A constant boolean provider.  No inputs — just outputs its configured
 * value whenever the graph evaluates.
 *
 * Output ports:
 *   value : boolean — the configured boolean value
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "boolean",
  label: "Boolean",
  role: "process",
  description: "Constant boolean value.",

  inputPorts: [],
  outputPorts: [
    { key: "value", label: "Value", type: "boolean" },
  ],

  configSchema: [
    { key: "value", label: "Value", type: "boolean", default: false },
  ],

  create(id, config) {
    return {
      role: "process" as const,
      id,
      kind: "boolean",

      async execute() {
        return { value: Boolean(config.value) };
      }
    };
  }
};
