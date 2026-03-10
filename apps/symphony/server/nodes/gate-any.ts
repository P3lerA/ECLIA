/**
 * gate-any — Gate node with dynamic inputs.
 *
 * Fires immediately when ANY dynamic input receives a value.
 * Passes through the triggering value on the "out" port.
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "gate-any",
  label: "Any",
  role: "gate",
  description: "Fire when any input arrives. Passes through the triggering value.",

  inputPorts: [],
  outputPorts: [
    { key: "out", label: "Output", type: "any", typeFromPort: "$din" },
  ],
  configSchema: [],

  dynamicInput: { type: "any", labelPrefix: "In" },

  create(id) {
    return {
      role: "gate" as const,
      id,
      kind: "gate-any",

      async execute(ctx) {
        for (const [key, val] of Object.entries(ctx.inputs)) {
          if (key.startsWith("din_") && val !== undefined) {
            return { out: val };
          }
        }
        return null;
      },
    };
  },
};
