import { joinUrl } from "@eclia/config";

import { buildTruncatedContext } from "../context.js";
import { inferVendorFromBaseUrl } from "../normalize.js";

import { streamOpenAICompatTurn } from "./openaiCompat.js";
import type { UpstreamProvider } from "./provider.js";

export function createOpenAICompatProvider(args: {
  baseUrl: string;
  upstreamModel: string;
}): UpstreamProvider {
  const baseUrl = args.baseUrl;
  const upstreamModel = args.upstreamModel;
  const url = joinUrl(baseUrl, "/chat/completions");

  const origin = {
    adapter: "openai_compat",
    vendor: inferVendorFromBaseUrl(baseUrl),
    baseUrl,
    model: upstreamModel
  };

  return {
    kind: "openai_compat",
    origin,
    upstreamModel,

    buildContext(history, tokenLimit) {
      return buildTruncatedContext(history, tokenLimit);
    },

    async streamTurn({ headers, messages, tools, signal, onDelta, debug }) {
      return await streamOpenAICompatTurn({
        url,
        headers,
        model: upstreamModel,
        messages,
        signal,
        tools,
        onDelta,
        debug
      });
    },

    buildAssistantToolCallMessage({ assistantText, toolCalls }) {
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

    buildToolResultMessage({ callId, content }) {
      return { role: "tool", tool_call_id: callId, content };
    }
  };
}
