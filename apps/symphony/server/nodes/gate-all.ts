/**
 * gate — Transform node.
 *
 * Collects values on input ports "a" and "b".  Fires only when both
 * have been received at least once.  Acts as the explicit replacement
 * for the old TriggerMode "all".
 *
 * Behaviour:
 *   - Latches each input: once a value arrives on "a", it's remembered
 *     until "b" also arrives (or vice versa).
 *   - When both are present, fires downstream and clears the latches.
 *
 * Input ports:
 *   a : any
 *   b : any
 *
 * Output ports:
 *   a : any  — passthrough of input a
 *   b : any  — passthrough of input b
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "gate-all",
  label: "All",
  role: "gate",
  description: "Wait for all inputs before firing.  Latches across evaluations using state.",

  inputPorts: [
    { key: "a", label: "Input A", type: "any" },
    { key: "b", label: "Input B", type: "any" }
  ],
  outputPorts: [
    { key: "a", label: "Output A", type: "any", typeFromPort: "a" },
    { key: "b", label: "Output B", type: "any", typeFromPort: "b" },
  ],

  configSchema: [],

  create(id) {
    return {
      role: "gate" as const,
      id,
      kind: "gate-all",

      async execute(ctx) {
        const hasA = ctx.inputs.a !== undefined;
        const hasB = ctx.inputs.b !== undefined;

        // Use node state to latch across separate source emissions.
        const latchA = hasA ? ctx.inputs.a : await ctx.state.get("latch_a");
        const latchB = hasB ? ctx.inputs.b : await ctx.state.get("latch_b");

        if (hasA) await ctx.state.set("latch_a", latchA);
        if (hasB) await ctx.state.set("latch_b", latchB);

        if (latchA !== undefined && latchB !== undefined) {
          await ctx.state.set("latch_a", undefined);
          await ctx.state.set("latch_b", undefined);
          return { a: latchA, b: latchB };
        }

        // Not all inputs ready — halt propagation.
        return null;
      }
    };
  }
};
