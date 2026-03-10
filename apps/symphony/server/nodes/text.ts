/**
 * text — Transform node.
 *
 * A constant text provider.  No inputs — just outputs its configured
 * content whenever the graph evaluates.  Think of it as an external
 * text editor that other nodes can read from.
 *
 * Output ports:
 *   text : string — the configured text value
 *
 * Config:
 *   content : text — the text to output
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "text",
  label: "Text",
  role: "process",
  description: "Constant text value.",

  inputPorts: [],
  outputPorts: [
    { key: "text", label: "Text", type: "string" },
  ],

  configSchema: [
    { key: "content", label: "Content", type: "text", placeholder: "Enter text..." },
  ],

  create(id, config) {
    return {
      role: "process" as const,
      id,
      kind: "text",

      async execute() {
        return { text: typeof config.content === "string" ? config.content : "" };
      }
    };
  }
};
