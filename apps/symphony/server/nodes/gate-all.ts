/**
 * gate-all — Gate node with dynamic inputs and outputs.
 *
 * Latches each incoming value.  Fires only when ALL wired dynamic
 * inputs have been received at least once, then clears the latches.
 *
 * Dynamic input keys (din_0, din_1, …) map 1:1 to dynamic output
 * keys (dout_0, dout_1, …) — the numeric suffix is matched.
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "gate-all",
  label: "All",
  role: "gate",
  description: "Wait for all inputs before firing.",

  inputPorts: [],
  outputPorts: [],
  configSchema: [],

  dynamicInput: { type: "any", labelPrefix: "In" },
  dynamicOutput: { type: "any", labelPrefix: "Out" },

  create(id, _config, dynamicPorts) {
    // Full set of expected input keys, known at creation time.
    const expectedKeys = (dynamicPorts?.inputs ?? []).map((p) => p.key);

    return {
      role: "gate" as const,
      id,
      kind: "gate-all",

      async execute(ctx) {
        if (expectedKeys.length === 0) return null;

        const dinKeys = Object.keys(ctx.inputs).filter((k) => k.startsWith("din_"));
        if (dinKeys.length === 0) return null;

        // Latch incoming values
        for (const key of dinKeys) {
          if (ctx.inputs[key] !== undefined) {
            await ctx.state.set(`latch:${key}`, ctx.inputs[key]);
          }
        }

        // Check ALL expected keys (not just keys seen so far)
        const values = new Map<string, unknown>();
        for (const key of expectedKeys) {
          const val = (dinKeys.includes(key) && ctx.inputs[key] !== undefined)
            ? ctx.inputs[key]
            : await ctx.state.get(`latch:${key}`);
          if (val == null) return null; // not all ready
          values.set(key, val);
        }

        // All ready — clear latches, emit on dout_* keys
        for (const key of expectedKeys) await ctx.state.set(`latch:${key}`, null);

        const output: Record<string, unknown> = {};
        for (const [key, val] of values) {
          output["dout_" + key.slice(4)] = val;
        }
        return output;
      },
    };
  },
};
