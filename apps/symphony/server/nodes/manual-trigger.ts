/**
 * manual-trigger — Source node.
 *
 * Does nothing on its own; waits for an external API call to fire.
 * Useful for testing pipelines or building manually-invoked flows.
 *
 * Output ports:
 *   out : any — the payload passed via the trigger API
 */

import type { NodeFactory, SourceNodeContext } from "../types.js";

export const factory: NodeFactory = {
  kind: "manual-trigger",
  label: "Manual Trigger",
  role: "source",
  description: "Fires when triggered via the API.  Useful for testing.",

  inputPorts: [],
  outputPorts: [
    { key: "signal", label: "Signal", type: "any", typeFrom: "signalType" }
  ],

  configSchema: [
    {
      key: "signalType",
      label: "Signal type",
      type: "select",
      options: ["none (any)", "string", "number", "boolean"],
      default: "none (any)",
    },
    {
      key: "signalValue",
      label: "Value",
      type: "string",
      default: "",
    },
  ],

  create(id, config) {
    let emitFn: ((outputs: Record<string, unknown>) => void) | null = null;

    return {
      role: "source" as const,
      id,
      kind: "manual-trigger",

      async start(ctx: SourceNodeContext) {
        emitFn = ctx.emit;
        ctx.log.info(`manual-trigger "${id}" ready — POST /opus/:opusId/trigger/${id} to fire`);
      },

      async stop() {
        emitFn = null;
      },

      /** Called externally by OpusRuntime.triggerNode(). */
      trigger(payload: unknown) {
        if (!emitFn) throw new Error("node not started");

        const type = String(config.signalType ?? "none (any)");
        let signal: unknown;
        switch (type) {
          case "boolean": signal = Boolean(config.signalValue); break;
          case "number":  signal = Number(config.signalValue) || 0; break;
          case "string":  signal = String(config.signalValue ?? ""); break;
          default:        signal = payload ?? { triggered: true, at: new Date().toISOString() }; break;
        }

        emitFn({ signal });
      }
    };
  }
};
