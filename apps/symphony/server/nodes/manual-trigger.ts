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

export const manualTriggerFactory: NodeFactory = {
  kind: "manual-trigger",
  label: "Manual Trigger",
  role: "source",
  description: "Fires when triggered via the API.  Useful for testing.",

  inputPorts: [],
  outputPorts: [
    { key: "out", label: "Output", type: "any" }
  ],

  configSchema: [],

  create(id) {
    let emitFn: ((outputs: Record<string, unknown>) => void) | null = null;

    return {
      role: "source" as const,
      id,
      kind: "manual-trigger",

      async start(ctx: SourceNodeContext) {
        emitFn = ctx.emit;
        ctx.log.info(`manual-trigger "${id}" ready — POST /flows/:flowId/trigger/${id} to fire`);
      },

      async stop() {
        emitFn = null;
      },

      /** Called externally by FlowRuntime.triggerNode(). */
      trigger(payload: unknown) {
        if (!emitFn) throw new Error("node not started");
        emitFn({ out: payload ?? { triggered: true, at: new Date().toISOString() } });
      }
    };
  }
};
