/**
 * number — Process node.
 *
 * A constant number provider.  Outputs its configured value
 * whenever the graph evaluates.
 *
 * Output ports:
 *   value : number
 *
 * Config:
 *   value : number — the number to output (default 0)
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "number",
  label: "Number",
  role: "process",
  description: "Constant number value.",

  inputPorts: [],
  outputPorts: [
    { key: "value", label: "Value", type: "number" },
  ],

  configSchema: [
    { key: "value", label: "Value", type: "number", default: 0 },
  ],

  create(id, config) {
    return {
      role: "process" as const,
      id,
      kind: "number",

      async execute() {
        return { value: Number(config.value) || 0 };
      }
    };
  }
};
