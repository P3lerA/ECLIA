/**
 * UpstreamProvider for the OpenAI Responses API.
 *
 * Reuses the same auth / profile as openai_compat but switches wire format:
 *   - Endpoint: POST /v1/responses (not /v1/chat/completions)
 *   - Input: typed items (not messages)
 *   - Tools: flat definitions (not nested under `function:`)
 *   - Tool results: function_call_output items (not role:"tool" messages)
 *
 * Internally, the gateway stores transcript in the canonical OpenAI-compat
 * message format. This provider converts to/from Responses API format at
 * the boundary (streamTurn).
 */

import { joinUrl } from "@eclia/config";

import { buildTruncatedContext } from "../context.js";
import { inferVendorFromBaseUrl } from "../normalize.js";

import { streamOpenAIResponsesTurn } from "./openaiResponses.js";
import type { ToolResult, UpstreamProvider } from "./provider.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function contentToText(content: any): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : ""))
      .join("");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

// ── Format conversion: internal → Responses API ─────────────────────────

/**
 * Convert internal OpenAI-compatible tools to Responses API tool format.
 *
 * Chat Completions:  { type:"function", function:{ name, description, parameters, strict } }
 * Responses API:     { type:"function", name, description, parameters, strict }
 */
function flattenTools(tools: any[]): any[] {
  if (!Array.isArray(tools)) return [];
  const out: any[] = [];

  for (const t of tools) {
    if (t?.type === "function" && t?.function) {
      const fn = t.function;
      const flat: any = { type: "function", name: fn.name };
      if (fn.description) flat.description = fn.description;
      if (fn.parameters) flat.parameters = fn.parameters;
      if (fn.strict !== undefined) flat.strict = fn.strict;
      if (flat.name) out.push(flat);
    } else {
      // Pass through non-function tools (e.g. future computer_use).
      out.push(t);
    }
  }

  return out;
}

/**
 * Convert internal OpenAI-compatible message history to Responses API input items.
 *
 * Mapping:
 *   {role:"system"}      → extracted as `instructions` (top-level param)
 *   {role:"user"}        → { role:"user", content:"..." }
 *   {role:"assistant"}   → { type:"message", role:"assistant", content:[{type:"output_text",...}] }
 *   tool_calls[]         → separate { type:"function_call", call_id, name, arguments }
 *   {role:"tool"}        → { type:"function_call_output", call_id, output }
 */
function toResponsesInput(messages: any[]): { instructions: string | undefined; input: any[] } {
  const input: any[] = [];
  let instructions: string | undefined;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    const role = typeof m.role === "string" ? m.role : "";

    if (role === "system") {
      // Last system message wins (gateway appends it at the end of the history
      // to survive truncation).
      instructions = contentToText(m.content);
      continue;
    }

    if (role === "user") {
      input.push({ role: "user", content: contentToText(m.content) });
      continue;
    }

    if (role === "assistant") {
      const text = contentToText(m.content);
      const toolCalls: any[] = Array.isArray(m.tool_calls) ? m.tool_calls : [];

      // Emit message item (even if text is empty — anchors the assistant turn).
      if (text || !toolCalls.length) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }]
        });
      }

      // Emit function_call items (separate from the message in Responses API).
      for (const tc of toolCalls) {
        const fn = tc?.function ?? {};
        const callId = typeof tc.id === "string" ? tc.id : "";
        const name = typeof fn.name === "string" ? fn.name : "";
        if (!callId || !name) continue;

        input.push({
          type: "function_call",
          call_id: callId,
          name,
          arguments: typeof fn.arguments === "string" ? fn.arguments : "{}"
        });
      }
      continue;
    }

    if (role === "tool") {
      const callId = typeof m.tool_call_id === "string" ? m.tool_call_id : "";
      if (!callId) continue;

      input.push({
        type: "function_call_output",
        call_id: callId,
        output: typeof m.content === "string" ? m.content : contentToText(m.content)
      });
      continue;
    }

    // Unknown role: drop.
  }

  return { instructions, input };
}

// ── Provider factory ────────────────────────────────────────────────────

export function createOpenAIResponsesProvider(args: {
  baseUrl: string;
  upstreamModel: string;
}): UpstreamProvider {
  const baseUrl = args.baseUrl;
  const upstreamModel = args.upstreamModel;
  const url = joinUrl(baseUrl, "/responses");

  const origin = {
    adapter: "openai_responses",
    vendor: inferVendorFromBaseUrl(baseUrl),
    baseUrl,
    model: upstreamModel
  };

  return {
    kind: "openai_responses",
    origin,
    upstreamModel,

    buildContext(history, tokenLimit) {
      // Truncate in internal format. Conversion to Responses items happens
      // in streamTurn so the progressive upstreamMessages array stays in
      // internal format (same pattern as openaiCompatProvider).
      return buildTruncatedContext(history, tokenLimit);
    },

    async streamTurn({ headers, messages, tools, temperature, topP, maxOutputTokens, signal, onDelta, debug }) {
      // Convert the accumulated internal-format messages to Responses API items.
      const { instructions, input } = toResponsesInput(messages);
      const responsesTools = flattenTools(tools);

      return await streamOpenAIResponsesTurn({
        url,
        headers,
        model: upstreamModel,
        instructions,
        input,
        tools: responsesTools.length ? responsesTools : undefined,
        temperature,
        topP,
        maxOutputTokens,
        signal,
        onDelta,
        debug
      });
    },

    buildAssistantToolCallMessage({ assistantText, toolCalls }) {
      // Store in internal (OpenAI-compatible) format.
      // Converted to Responses items in the next streamTurn call.
      return {
        role: "assistant",
        content: assistantText,
        tool_calls: toolCalls.map((c) => ({
          id: c.callId,
          type: "function",
          function: { name: c.name, arguments: c.argsRaw }
        }))
      };
    },

    buildToolResultMessages({ results }: { results: ToolResult[] }) {
      // Store in internal (OpenAI-compatible) format.
      return results.map((r) => ({
        role: "tool",
        tool_call_id: r.callId,
        content: typeof r.content === "string" ? r.content : JSON.stringify(r.content)
      }));
    }
  };
}
