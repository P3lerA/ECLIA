/**
 * converter-n2s — Process node.
 *
 * Converts a number input to its string representation.
 *
 * Input ports:
 *   input : number
 *
 * Output ports:
 *   output : string
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "converter-n2s",
  label: "Number → String",
  role: "process",
  description: "Convert a number to a string.",

  inputPorts: [
    { key: "input", label: "Input", type: "number" },
  ],
  outputPorts: [
    { key: "output", label: "Output", type: "string" },
  ],

  configSchema: [],

  create(id) {
    return {
      role: "process" as const,
      id,
      kind: "converter-n2s",

      async execute(ctx) {
        return { output: String(ctx.inputs.input ?? 0) };
      }
    };
  }
};
