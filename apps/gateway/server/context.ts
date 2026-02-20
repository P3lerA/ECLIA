import { Buffer } from "node:buffer";

import type { OpenAICompatMessage } from "./transcriptTypes.js";

/**
 * Conservative token estimator.
 *
 * Why estimate:
 * - Different vendors use different tokenizers.
 * - We only need truncation to avoid blowing up context; exact counts are not required.
 */
export function estimateTokens(text: string): number {
  const s = typeof text === "string" ? text : "";
  if (!s) return 0;
  const bytes = Buffer.byteLength(s, "utf8");
  // Conservative: assume ~3.25 bytes per token.
  return Math.ceil(bytes / 3.25);
}

export function buildTruncatedContext(
  history: OpenAICompatMessage[],
  tokenLimit: number
): { messages: OpenAICompatMessage[]; usedTokens: number; dropped: number } {
  const limit = clampInt(tokenLimit, 256, 1_000_000);

  // Keep the last system message (if any) as an anchor.
  let systemMsg: OpenAICompatMessage | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "system") {
      systemMsg = history[i];
      break;
    }
  }

  const nonSystem = history.filter((m) => m && m.role !== "system");

  // Turn-based truncation:
  // keep whole user-turns atomically to avoid broken tool-call chains and
  // partial reasoning blocks. A "turn" starts at a user message and includes
  // all subsequent assistant/tool messages until the next user message.
  const groups = groupTurns(nonSystem);

  const selected: typeof groups = [];
  let used = systemMsg ? estimateTokens(messageForEstimate(systemMsg)) + 8 : 0;

  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (selected.length === 0) {
      // Always keep the last group (which includes the last message).
      selected.push(g);
      used += g.tokens;
      continue;
    }
    if (used + g.tokens > limit) continue;
    selected.push(g);
    used += g.tokens;
  }

  selected.reverse();

  const out: OpenAICompatMessage[] = [];
  if (systemMsg) out.push(systemMsg);
  for (const g of selected) out.push(...g.msgs);

  const keptCount = selected.reduce((n, g) => n + g.msgs.length, 0);
  const dropped = nonSystem.length - keptCount;
  return { messages: out, usedTokens: used, dropped };
}

function groupTurns(messages: OpenAICompatMessage[]): Array<{ msgs: OpenAICompatMessage[]; tokens: number }> {
  const groups: Array<{ msgs: OpenAICompatMessage[]; tokens: number }> = [];

  let cur: OpenAICompatMessage[] = [];
  let curTokens = 0;

  const flush = () => {
    if (cur.length === 0) return;
    groups.push({ msgs: cur, tokens: curTokens });
    cur = [];
    curTokens = 0;
  };

  for (const m of messages) {
    if (!m) continue;

    // A new user message starts a new turn.
    if (m.role === "user") {
      flush();
    }

    cur.push(m);
    curTokens += estimateTokens(messageForEstimate(m)) + 4;
  }

  flush();
  return groups;
}

function messageForEstimate(msg: OpenAICompatMessage): string {
  const role = typeof (msg as any)?.role === "string" ? (msg as any).role : "";
  const content = contentToText((msg as any)?.content);

  if (role === "assistant") {
    const toolCalls = Array.isArray((msg as any).tool_calls) ? (msg as any).tool_calls : undefined;
    if (toolCalls && toolCalls.length) return `${content}\n${safeJson(toolCalls)}`;
  }

  if (role === "tool") {
    const tci = typeof (msg as any).tool_call_id === "string" ? (msg as any).tool_call_id : "";
    return tci ? `${tci}\n${content}` : content;
  }

  return content;
}

function contentToText(v: any): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}
