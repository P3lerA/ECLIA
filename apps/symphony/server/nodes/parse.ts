/**
 * parse — Process node.
 *
 * Destructures an object into separate output ports.
 * Output ports are auto-generated at design time from the connected
 * source port's `objectKeys` declaration.
 *
 * At runtime, extracts all top-level keys from the input object.
 *
 * Input ports:
 *   in : object — the object to destructure
 *
 * Output ports: (dynamic, auto-generated from connection)
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "parse",
  label: "Parse",
  role: "process",
  description: "Destructure an object into keyed output ports.",

  inputPorts: [{ key: "in", label: "Object", type: "object" }],
  outputPorts: [],
  configSchema: [],

  dynamicOutput: { type: "any", labelPrefix: "", auto: true },

  create(id) {
    return {
      role: "process" as const,
      id,
      kind: "parse",

      async execute(ctx) {
        const obj = ctx.inputs.in;
        if (obj == null || typeof obj !== "object") return null;

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
          result[key] = value;
        }
        return result;
      },
    };
  },
};
