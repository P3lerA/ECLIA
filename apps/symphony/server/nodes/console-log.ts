/**
 * console-log — Sink node.
 *
 * Prints to stdout via the flow logger.
 *
 * Input ports:
 *   signal : any      — trigger
 *   text   : string   — (optional) text to log; falls back to config `text`
 *
 * Config:
 *   prefix : string — log prefix (default "LOG")
 *   text   : text   — fallback text when `text` input is not connected
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "console-log",
  label: "Console Log",
  role: "action",
  description: "Logs input to the server console.  Useful for testing.",

  inputPorts: [
    { key: "signal", label: "Signal", type: "any" },
    { key: "text", label: "Text", type: "string", optional: true },
  ],
  outputPorts: [],

  configSchema: [
    { key: "prefix", label: "Log prefix", type: "string", placeholder: "LOG" },
    { key: "text", label: "Text", type: "text", placeholder: "Fallback text when input not connected" },
  ],

  create(id, config) {
    const prefix = typeof config.prefix === "string" && config.prefix ? config.prefix : "LOG";
    const fallbackText = typeof config.text === "string" ? config.text : "";

    return {
      role: "action" as const,
      id,
      kind: "console-log",

      async execute(ctx) {
        // Prefer text input, then config fallback, then stringify signal
        const text = ctx.inputs.text ?? (fallbackText || stringify(ctx.inputs.signal));
        ctx.log.info(`[${prefix}] ${text}`);
        return {};
      }
    };
  }
};

function stringify(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}
