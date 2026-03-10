/**
 * gate-any — Gate node.
 *
 * Fires immediately when ANY input receives a value.
 * Unlike gate-all which waits for all inputs, this triggers
 * on the first input that arrives.
 *
 * Input ports:
 *   a : any
 *   b : any
 *
 * Output ports:
 *   out : any  — the value that triggered the gate
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "gate-any",
  label: "Any",
  role: "gate",
  description: "Fire when any input arrives. Passes through the triggering value.",

  inputPorts: [
    { key: "a", label: "Input A", type: "any" },
    { key: "b", label: "Input B", type: "any" },
  ],
  outputPorts: [
    { key: "out", label: "Output", type: "any", typeFromPort: ["a", "b"] },
  ],

  configSchema: [],

  create(id) {
    return {
      role: "gate" as const,
      id,
      kind: "gate-any",

      async execute(ctx) {
        // Fire on whichever input arrived
        if (ctx.inputs.a !== undefined) return { out: ctx.inputs.a };
        if (ctx.inputs.b !== undefined) return { out: ctx.inputs.b };
        return null;
      },
    };
  },
};
