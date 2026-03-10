/**
 * not — Process node.
 *
 * Inverts a boolean value.
 *
 * Input ports:
 *   in : boolean
 *
 * Output ports:
 *   out : boolean
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "not",
  label: "Not",
  role: "process",
  description: "Invert a boolean value.",

  inputPorts: [
    { key: "in", label: "In", type: "boolean" },
  ],
  outputPorts: [
    { key: "out", label: "Out", type: "boolean" },
  ],

  configSchema: [],

  create(id) {
    return {
      role: "process" as const,
      id,
      kind: "not",

      async execute(ctx) {
        return { out: !ctx.inputs.in };
      }
    };
  }
};
