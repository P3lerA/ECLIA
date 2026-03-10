/**
 * gate-accumulate — Gate node.
 *
 * Counts activations on its input port.  Fires only when the
 * count reaches the configured threshold N, then resets.
 *
 * The threshold can be set via config or wired as a connectable
 * input, allowing dynamic control of when the gate opens.
 *
 * Input ports:
 *   in : any  — each arrival increments the counter
 *
 * Output ports:
 *   out   : any  — the value from the Nth (final) activation
 *   count : number — the threshold that was reached
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "gate-accumulate",
  label: "Accumulate",
  role: "gate",
  description: "Fire after N activations, then reset.",

  inputPorts: [
    { key: "in", label: "Input", type: "any" },
  ],
  outputPorts: [
    { key: "out", label: "Output", type: "any", typeFromPort: "in" },
    { key: "count", label: "Count", type: "number" },
  ],

  configSchema: [
    {
      key: "threshold",
      label: "Threshold (N)",
      type: "number",
      default: 3,
      placeholder: "3",
      connectable: true,
    },
  ],

  create(id, config) {
    return {
      role: "gate" as const,
      id,
      kind: "gate-accumulate",

      async execute(ctx) {
        if (ctx.inputs.in === undefined) return null;

        const threshold = Number(
          ctx.inputs.threshold ?? config.threshold ?? 3
        );

        const prev = ((await ctx.state.get<number>("count")) ?? 0) + 1;

        if (prev >= threshold) {
          await ctx.state.set("count", 0);
          return { out: ctx.inputs.in, count: threshold };
        }

        await ctx.state.set("count", prev);
        ctx.log.info(`accumulate ${prev}/${threshold}`);
        return null;
      },
    };
  },
};
