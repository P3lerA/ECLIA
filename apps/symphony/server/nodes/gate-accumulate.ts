/**
 * gate-accumulate — Gate node with dynamic inputs.
 *
 * Counts activations across all dynamic input ports.  Fires only
 * when the count reaches the configured threshold N, then resets.
 *
 * Output ports:
 *   out   : any    — the value from the Nth (final) activation
 *   count : number — the threshold that was reached
 *
 * Config:
 *   threshold : number (connectable) — activations needed to fire
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "gate-accumulate",
  label: "Accumulate",
  role: "gate",
  description: "Fire after N activations, then reset.",

  inputPorts: [],
  outputPorts: [
    { key: "out", label: "Output", type: "any", typeFromPort: "$din" },
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

  dynamicInput: { type: "any", labelPrefix: "In" },

  create(id, config) {
    return {
      role: "gate" as const,
      id,
      kind: "gate-accumulate",

      async execute(ctx) {
        // Check if any dynamic input arrived
        let triggerValue: unknown;
        for (const [key, val] of Object.entries(ctx.inputs)) {
          if (key.startsWith("din_") && val !== undefined) {
            triggerValue = val;
            break;
          }
        }
        if (triggerValue === undefined) return null;

        const threshold = Number(config.threshold ?? 3);
        const prev = ((await ctx.state.get<number>("count")) ?? 0) + 1;

        if (prev >= threshold) {
          await ctx.state.set("count", 0);
          return { out: triggerValue, count: threshold };
        }

        await ctx.state.set("count", prev);
        ctx.log.info(`accumulate ${prev}/${threshold}`);
        return null;
      },
    };
  },
};
