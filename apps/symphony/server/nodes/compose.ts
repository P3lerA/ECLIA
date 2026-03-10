/**
 * compose — Process node.
 *
 * Template-based string composition with dynamic variable inputs.
 * The template uses {{VAR_1}}, {{VAR_2}}, … placeholders that correspond
 * to dynamic input ports.  At runtime, each placeholder is replaced
 * with the stringified value of the matching input.
 *
 * Input ports: (dynamic — user adds as needed)
 *   din_0 … din_N : string — template variables
 *
 * Output ports:
 *   text : string — the composed result
 *
 * Config:
 *   template : text — e.g. "Hello {{VAR_1}}, your score is {{VAR_2}}"
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "compose",
  label: "Compose",
  role: "process",
  description: "Compose text from a template with variable inputs.",

  inputPorts: [],
  outputPorts: [
    { key: "text", label: "Text", type: "string" },
  ],

  configSchema: [
    { key: "template", label: "Template", type: "text", placeholder: "Hello {{VAR_1}}, your score is {{VAR_2}}", connectable: true },
  ],

  dynamicInput: { type: "string", labelPrefix: "VAR_" },

  create(id, config) {
    return {
      role: "process" as const,
      id,
      kind: "compose",

      async execute(ctx) {
        // Runtime transparently merges cfg: wires into config before execute().
        const template = typeof config.template === "string" ? config.template : "";

        // Build a map from VAR number → value.
        // din_0 → VAR_1, din_2 → VAR_3, etc.  The key suffix is stable
        // even when ports are deleted, so VAR_N always maps to din_(N-1).
        const varMap = new Map<number, string>();
        for (const [k, v] of Object.entries(ctx.inputs)) {
          if (!k.startsWith("din_")) continue;
          const suffix = parseInt(k.slice(4), 10);
          varMap.set(suffix + 1, v == null ? "" : String(v));
        }

        const text = template.replace(/\{\{VAR_(\d+)\}\}/g, (_match, num) => {
          return varMap.get(parseInt(num, 10)) ?? "";
        });

        return { text };
      },
    };
  },
};
