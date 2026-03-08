/**
 * llm-process — Transform node.
 *
 * Takes arbitrary data on the "data" input port, renders it into a
 * prompt via a template, sends it through the gateway LLM, and
 * outputs the response.  Returns null (halts) if the LLM responds
 * with "IGNORE".
 *
 * Input ports:
 *   data : any  — the upstream payload (email, webhook body, etc.)
 *
 * Output ports:
 *   text : string  — the LLM response text
 *   data : any     — passthrough of the input data (for downstream use)
 */

import type { NodeFactory } from "../types.js";

export const llmProcessFactory: NodeFactory = {
  kind: "llm-process",
  label: "LLM Process",
  role: "transform",
  description: "Send data through an LLM with a prompt template.  Halts if the model responds IGNORE.",

  inputPorts: [
    { key: "data", label: "Data", type: "any" }
  ],
  outputPorts: [
    { key: "text", label: "Response", type: "string" },
    { key: "data", label: "Passthrough", type: "any" }
  ],

  configSchema: [
    { key: "criterion",       label: "Criterion / instruction", type: "text",   required: true, placeholder: "Notify me if the email is about…" },
    { key: "promptTemplate",  label: "Prompt Template",         type: "text",   placeholder: "Leave blank for default" },
    { key: "model",           label: "Model",                   type: "model" }
  ],

  create(id, config) {
    return {
      role: "transform" as const,
      id,
      kind: "llm-process",

      async execute(ctx) {
        const data = ctx.inputs.data;
        // TODO: port the gateway chat call from old LlmTriageAction.
        // Build prompt from template + data, call runGatewayChat(), check for IGNORE.
        ctx.log.info(`[llm-process] would process data with criterion: "${config.criterion}"`);
        return { text: "(stub response)", data };
      }
    };
  }
};
