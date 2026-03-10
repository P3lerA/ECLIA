/**
 * llm-process — Transform node ("Model Action").
 *
 * Sends text through the gateway LLM and outputs the response.
 *
 * Input ports:
 *   text : string  — the user message to send to the model
 *
 * Output ports:
 *   modelOutput : string  — the model's response text
 *
 * Config:
 *   specifySessionId : boolean — if true, use the manually provided sessionId;
 *                                if false, auto-generate sym_{opusId}_{nodeId}
 *   sessionId : string         — manual session id (only when specifySessionId=true)
 *   model : string             — upstream model route key (optional)
 *   includeHistory : boolean   — include prior session history (default: false)
 *   systemInstructionOverride : string — override the system prompt
 *   skipMemoryRecall : boolean — skip built-in memory recall (default: true)
 *   enabledTools : string      — comma-separated list of tool names
 *   contextTokenLimit : number — token limit for upstream context
 */

import { ensureGatewaySession, runGatewayChat } from "@eclia/gateway-client";
import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "llm-process",
  label: "Model Action",
  role: "action",
  description: "Send text to an LLM via the gateway and output the response.",

  inputPorts: [
    { key: "text", label: "Text", type: "string" }
  ],
  outputPorts: [
    { key: "modelOutput", label: "Model Output", type: "string" }
  ],

  configSchema: [
    { key: "specifySessionId",        label: "Use custom Session ID",  type: "boolean", default: false },
    { key: "sessionId",              label: "Session ID",              type: "string",  placeholder: "Auto-generated if unchecked" },
    { key: "model",                  label: "Model",                   type: "model" },
    { key: "includeHistory",         label: "Include History",         type: "boolean", default: false },
    { key: "systemInstructionOverride", label: "System Prompt Override", type: "text",  placeholder: "Leave blank for default", connectable: true },
    { key: "skipMemoryRecall",       label: "Skip Memory Recall",      type: "boolean", default: true, connectable: true },
    { key: "enabledTools",           label: "Enabled Tools",           type: "string",  placeholder: "Comma-separated, e.g. send,web", connectable: true },
    { key: "sendDestination",        label: "Send Destination",        type: "select",  options: ["web", "discord", "telegram"], default: "web", connectable: true },
    { key: "sendChannelId",          label: "Channel ID",              type: "string",  placeholder: "Required for Discord/Telegram", connectable: true },
    { key: "contextTokenLimit",      label: "Context Token Limit",     type: "number",  placeholder: "Leave blank for default" },
  ],

  create(id, config) {
    return {
      role: "action" as const,
      id,
      kind: "llm-process",

      async execute(ctx) {
        const userText = String(ctx.inputs.text ?? "");
        if (!userText.trim()) {
          ctx.log.warn(`[model-action] empty input text, halting`);
          return null;
        }

        const { gatewayUrl, opusId } = ctx.services;

        const sessionId = config.specifySessionId
          ? String(config.sessionId ?? "")
          : `sym_${opusId}_${id}`;

        if (!sessionId) {
          ctx.log.warn(`[model-action] no session ID, halting`);
          return null;
        }

        // Ensure the session exists (idempotent).
        const sendDest = String(config.sendDestination || "web");
        const sendChannelId = config.sendChannelId ? String(config.sendChannelId).trim() : undefined;
        const replyTo: Record<string, unknown> = { kind: sendDest };
        if (sendDest === "discord" && sendChannelId) replyTo.channelId = sendChannelId;
        if (sendDest === "telegram" && sendChannelId) replyTo.chatId = sendChannelId;
        try {
          await ensureGatewaySession(gatewayUrl, sessionId, `Symphony · ${id}`, {
            kind: "symphony", opusId, nodeId: id, replyTo,
          }, { hideInMenuSheet: true });
        } catch (e: unknown) {
          ctx.log.warn(`[model-action] session ensure failed (may already exist): ${(e as Error).message}`);
        }

        // Build optional fields from config (connectable overrides take precedence via runtime).
        const model = config.model ? String(config.model) : undefined;
        const includeHistory = Boolean(config.includeHistory);
        const systemInstructionOverride = config.systemInstructionOverride
          ? String(config.systemInstructionOverride)
          : undefined;
        const skipMemoryRecall = config.skipMemoryRecall !== false;
        const contextTokenLimit = config.contextTokenLimit
          ? Number(config.contextTokenLimit)
          : undefined;
        const enabledTools = config.enabledTools
          ? String(config.enabledTools).split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;

        ctx.log.info(`[model-action] sending to model (session=${sessionId}): "${userText.slice(0, 80)}…"`);

        try {
          const { text } = await runGatewayChat({
            gatewayUrl,
            sessionId,
            userText,
            model,
            includeHistory,
            systemInstructionOverride,
            skipMemoryRecall,
            enabledTools,
            contextTokenLimit,
            streamMode: "final",
            origin: { kind: "symphony", opusId, nodeId: id },
          });

          return { modelOutput: text };
        } catch (e: unknown) {
          ctx.log.error(`[model-action] gateway chat failed: ${(e as Error).message}`);
          return null;
        }
      }
    };
  }
};
