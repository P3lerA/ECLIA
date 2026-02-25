import type { OpenAICompatMessage } from "../transcriptTypes.js";

function isRecord(v: unknown): v is Record<string, any> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function contentToText(content: any): string {
  if (typeof content === "string") return content;

  // OpenAI-compatible "content" can also be an array of blocks.
  // We intentionally keep this very small (ECLIA persists mostly strings today).
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (!b) continue;
      if (typeof b === "string") {
        parts.push(b);
        continue;
      }
      if (isRecord(b) && typeof b.text === "string") parts.push(b.text);
    }
    return parts.join("");
  }

  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toolUseInputFromArgsRaw(argsRaw: string): any {
  const parsed = safeJsonParse(argsRaw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;

  // Repair legacy malformed args strings that look like "{}" + "{...}".
  // This can happen if an upstream streams tool input via input_json_delta while
  // emitting an empty object for tool_use.input in content_block_start.
  if (argsRaw && typeof argsRaw === "string") {
    const s = argsRaw.trimStart();
    if (s.startsWith("{}") && s.length > 2) {
      const candidate = s.slice(2).trimStart();
      const parsed2 = safeJsonParse(candidate);
      if (parsed2 && typeof parsed2 === "object" && !Array.isArray(parsed2)) return parsed2;
    }
  }

  // Keep it an object (Anthropic expects tool_use.input to be an object).
  return argsRaw && typeof argsRaw === "string" ? { __raw: argsRaw } : {};
}

export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: any;
};

export function openAIToolsToAnthropicTools(openaiTools: any[]): AnthropicTool[] {
  const out: AnthropicTool[] = [];
  if (!Array.isArray(openaiTools)) return out;

  for (const t of openaiTools) {
    const fn = isRecord(t) && t.type === "function" && isRecord(t.function) ? t.function : null;
    if (!fn) continue;

    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) continue;

    const description = typeof fn.description === "string" && fn.description.trim() ? fn.description.trim() : undefined;
    const input_schema = fn.parameters && typeof fn.parameters === "object" ? fn.parameters : { type: "object" };

    out.push({ name, description, input_schema });
  }

  return out;
}

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: any;
};

/**
 * Convert an OpenAI-compatible message list into Anthropic Messages API format.
 *
 * Returns:
 * - system: extracted from the first system message (if present)
 * - messages: Anthropic {role:user|assistant, content} list
 *
 * Important:
 * - OpenAI tool results are separate {role:"tool"} messages.
 * - Anthropic requires tool results to be provided via a *user* message with
 *   `tool_result` blocks.
 */
export function openAICompatToAnthropicMessages(openaiMessages: OpenAICompatMessage[]): {
  system?: string;
  messages: AnthropicMessage[];
} {
  const msgs = Array.isArray(openaiMessages) ? openaiMessages : [];

  let i = 0;
  let system: string | undefined;
  if (msgs.length && (msgs[0] as any)?.role === "system") {
    system = contentToText((msgs[0] as any).content);
    i = 1;
  }

  const out: AnthropicMessage[] = [];

  while (i < msgs.length) {
    const m: any = msgs[i];
    const role = typeof m?.role === "string" ? m.role : "";

    if (role === "user") {
      out.push({ role: "user", content: contentToText(m.content) });
      i++;
      continue;
    }

    if (role === "assistant") {
      const assistantText = contentToText(m.content);
      const toolCalls = Array.isArray(m.tool_calls) ? (m.tool_calls as any[]) : [];

      if (toolCalls.length) {
        // Collect consecutive tool messages that correspond to this tool-use round.
        const toolMsgs: any[] = [];
        let j = i + 1;
        while (j < msgs.length && (msgs[j] as any)?.role === "tool") {
          toolMsgs.push(msgs[j] as any);
          j++;
        }

        // If tool calls exist but we don't have tool results, do NOT emit tool_use blocks.
        // Anthropic will reject histories where tool_use isn't followed by tool_result.
        if (toolMsgs.length) {
          const blocks: any[] = [];
          if (assistantText) blocks.push({ type: "text", text: assistantText });

          for (const tc of toolCalls) {
            const id = typeof tc?.id === "string" ? tc.id : "";
            const fn = isRecord(tc?.function) ? tc.function : null;
            const name = fn && typeof fn.name === "string" ? fn.name : "";
            const argsRaw = fn && typeof fn.arguments === "string" ? fn.arguments : "{}";
            if (!id || !name) continue;

            blocks.push({
              type: "tool_use",
              id,
              name,
              input: toolUseInputFromArgsRaw(argsRaw)
            });
          }

          // Always emit the assistant message (even if only tool_use blocks remain).
          out.push({ role: "assistant", content: blocks.length ? blocks : assistantText });

          // Merge all tool results into a single user message.
          const resultBlocks: any[] = [];
          for (const tm of toolMsgs) {
            const toolUseId = typeof tm?.tool_call_id === "string" ? tm.tool_call_id : "";
            const content = contentToText(tm.content);
            if (!toolUseId) continue;

            const b: any = { type: "tool_result", tool_use_id: toolUseId, content };
            resultBlocks.push(b);
          }

          out.push({ role: "user", content: resultBlocks });

          i = j;
          continue;
        }
      }

      // Plain assistant message (no tool calls, or tool calls without results).
      out.push({ role: "assistant", content: assistantText });
      i++;
      continue;
    }

    if (role === "tool") {
      // Orphan tool result (should not happen in a well-formed transcript).
      // Keep it as a synthetic user text block rather than emitting an invalid tool_result.
      const callId = typeof m?.tool_call_id === "string" ? m.tool_call_id : "";
      const c = contentToText(m.content);
      out.push({ role: "user", content: callId ? `Tool result (${callId}): ${c}` : `Tool result: ${c}` });
      i++;
      continue;
    }

    // Unknown role: drop.
    i++;
  }

  return { system, messages: out };
}

export function buildAnthropicToolResultMessage(args: { results: Array<{ callId: string; content: string; ok: boolean }> }): AnthropicMessage {
  const blocks = args.results.map((r) => {
    const b: any = { type: "tool_result", tool_use_id: r.callId, content: r.content };
    if (!r.ok) b.is_error = true;
    return b;
  });
  return { role: "user", content: blocks };
}

export function buildAnthropicAssistantToolUseMessage(args: { assistantText: string; toolCalls: Array<{ callId: string; name: string; argsRaw: string }> }): AnthropicMessage {
  const blocks: any[] = [];
  if (args.assistantText) blocks.push({ type: "text", text: args.assistantText });

  for (const c of args.toolCalls) {
    blocks.push({
      type: "tool_use",
      id: c.callId,
      name: c.name,
      input: toolUseInputFromArgsRaw(c.argsRaw)
    });
  }

  return { role: "assistant", content: blocks.length ? blocks : args.assistantText };
}
