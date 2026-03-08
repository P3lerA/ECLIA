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

export const gateFactory: NodeFactory = {
  kind: "gate",
  label: "Gate (All)",
  role: "transform",
  description: "Wait for all inputs before firing.  Replaces the 'all' trigger combinator.",

  inputPorts: [
    { key: "a", label: "Input A", type: "any" },
    { key: "b", label: "Input B", type: "any", optional: true }
  ],
  outputPorts: [
    { key: "a", label: "Output A", type: "any" },
    { key: "b", label: "Output B", type: "any" }
  ],

  configSchema: [],

  create(id) {
    return {
      role: "transform" as const,
      id,
      kind: "gate",

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
