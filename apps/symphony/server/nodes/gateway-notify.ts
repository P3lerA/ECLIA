/**
 * gateway-notify — Sink node.
 *
 * Sends a message through the gateway's "send" tool (Discord, Telegram, etc.).
 *
 * Input ports:
 *   text : string  — the message to send
 *
 * Output ports: (none — this is a terminal node)
 */

import type { NodeFactory } from "../types.js";

export const gatewayNotifyFactory: NodeFactory = {
  kind: "gateway-notify",
  label: "Notify",
  role: "sink",
  description: "Send a notification message via Discord, Telegram, or other adapter.",

  inputPorts: [
    { key: "text", label: "Message", type: "string" }
  ],
  outputPorts: [],

  configSchema: [
    { key: "adapter",  label: "Adapter",           type: "select", options: ["discord", "telegram"], default: "discord" },
    { key: "channel",  label: "Channel / Chat ID", type: "string", required: true, placeholder: "Channel ID or Chat ID" }
  ],

  create(id, config) {
    return {
      role: "sink" as const,
      id,
      kind: "gateway-notify",

      async execute(ctx) {
        const text = String(ctx.inputs.text ?? "");
        if (!text) {
          ctx.log.warn("[gateway-notify] empty message — skipping");
          return {};
        }
        // TODO: call the gateway send tool or adapter API.
        ctx.log.info(`[gateway-notify] would send to ${config.adapter}/${config.channel}: ${text.slice(0, 80)}…`);
        return {};
      }
    };
  }
};
