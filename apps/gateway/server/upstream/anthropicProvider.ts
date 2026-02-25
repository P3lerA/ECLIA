import { buildTruncatedContext } from "../context.js";
import { inferVendorFromBaseUrl } from "../normalize.js";

import type { OpenAICompatMessage } from "../transcriptTypes.js";

import { streamAnthropicTurn } from "./anthropic.js";
import {
  buildAnthropicAssistantToolUseMessage,
  buildAnthropicToolResultMessage,
  openAICompatToAnthropicMessages,
  openAIToolsToAnthropicTools
} from "./anthropicFormat.js";
import type { ToolResult, UpstreamProvider } from "./provider.js";

function anthropicMessagesUrl(baseUrl: string): string {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "https://api.anthropic.com/v1/messages";
  if (trimmed.endsWith("/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

function contentToText(content: any): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function createAnthropicProvider(args: {
  baseUrl: string;
  upstreamModel: string;
  anthropicVersion?: string;
}): UpstreamProvider {
  const baseUrl = args.baseUrl;
  const upstreamModel = args.upstreamModel;
  const url = anthropicMessagesUrl(baseUrl);
  const anthropicVersion = String(args.anthropicVersion ?? "2023-06-01").trim() || "2023-06-01";

  const origin = {
    adapter: "anthropic",
    vendor: inferVendorFromBaseUrl(baseUrl),
    baseUrl,
    model: upstreamModel
  };

  return {
    kind: "anthropic",
    origin,
    upstreamModel,

    buildContext(history: OpenAICompatMessage[], tokenLimit: number) {
      const built = buildTruncatedContext(history, tokenLimit);
      const { system, messages } = openAICompatToAnthropicMessages(built.messages as any);

      const out: any[] = [];
      if (system && system.trim()) out.push({ role: "system", content: system });
      out.push(...messages);

      return { messages: out, usedTokens: built.usedTokens, dropped: built.dropped };
    },

    async streamTurn({ headers, messages, tools, temperature, topP, topK, maxOutputTokens, signal, onDelta, debug }) {
      // Extract our synthetic system message.
      let system: string | undefined;
      let msgs = messages;
      if (Array.isArray(msgs) && msgs.length && (msgs[0] as any)?.role === "system") {
        system = contentToText((msgs[0] as any)?.content);
        msgs = msgs.slice(1);
      }

      const anthropicTools = openAIToolsToAnthropicTools(tools);

      return await streamAnthropicTurn({
        url,
        headers,
        anthropicVersion,
        model: upstreamModel,
        system,
        messages: msgs,
        tools: anthropicTools.length ? anthropicTools : undefined,
        toolChoice: anthropicTools.length ? { type: "auto" } : undefined,
        temperature,
        topP,
        topK,
        maxOutputTokens,
        signal,
        onDelta,
        debug
      });
    },

    buildAssistantToolCallMessage({ assistantText, toolCalls }) {
      return buildAnthropicAssistantToolUseMessage({ assistantText, toolCalls });
    },

    buildToolResultMessages({ results }: { results: ToolResult[] }) {
      return [buildAnthropicToolResultMessage({ results })];
    }
  };
}
