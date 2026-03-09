/**
 * console-log — Sink node.
 *
 * Prints whatever it receives to stdout via the flow logger.
 * Useful for testing and debugging pipelines.
 *
 * Input ports:
 *   in : any — the value to log
 */

import type { NodeFactory } from "../types.js";

export const consoleLogFactory: NodeFactory = {
  kind: "console-log",
  label: "Console Log",
  role: "sink",
  description: "Logs input to the server console.  Useful for testing.",

  inputPorts: [
    { key: "in", label: "Input", type: "any" }
  ],
  outputPorts: [],

  configSchema: [
    { key: "prefix", label: "Log prefix", type: "string", placeholder: "LOG" }
  ],

  create(id, config) {
    const prefix = typeof config.prefix === "string" && config.prefix ? config.prefix : "LOG";

    return {
      role: "sink" as const,
      id,
      kind: "console-log",

      async execute(ctx) {
        const value = ctx.inputs.in;
        const pretty = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        ctx.log.info(`[${prefix}] ${pretty}`);
        return {};
      }
    };
  }
};
