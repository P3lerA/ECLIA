import { Buffer } from "node:buffer";
import type { StoredMessage } from "./sessionTypes.js";

/**
 * Conservative token estimator.
 *
 * Why estimate:
 * - Different vendors use different tokenizers.
 * - We only need truncation to avoid blowing up context; exact counts are not required.
 *
 * Approach:
 * - Use UTF-8 byte length as a language-agnostic proxy.
 * - Use a conservative bytes/token ratio to truncate earlier rather than later.
 *
 * NOTE: This is an estimator; upstream may still reject if its real limit is smaller.
 */
export function estimateTokens(text: string): number {
  const s = typeof text === "string" ? text : "";
  if (!s) return 0;
  const bytes = Buffer.byteLength(s, "utf8");
  // Conservative: assume ~3.25 bytes per token.
  return Math.ceil(bytes / 3.25);
}

export function messageToVisibleText(msg: StoredMessage): string {
  // Join "visible" blocks only. Thought blocks are excluded by default.
  const parts: string[] = [];
  for (const b of msg.blocks ?? []) {
    if (!b || typeof (b as any).type !== "string") continue;
    if ((b as any).type === "thought") continue;

    if ((b as any).type === "text") {
      const t = typeof (b as any).text === "string" ? (b as any).text : "";
      if (t) parts.push(t);
      continue;
    }

    if ((b as any).type === "code") {
      const code = typeof (b as any).code === "string" ? (b as any).code : "";
      const lang = typeof (b as any).language === "string" ? (b as any).language : "code";
      if (code) parts.push(`\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`);
      continue;
    }

    if ((b as any).type === "tool") {
      const name = typeof (b as any).name === "string" ? (b as any).name : "tool";
      const status = typeof (b as any).status === "string" ? (b as any).status : "ok";
      const payload = (b as any).payload ?? {};
      // IMPORTANT: Avoid serializing tool blocks using a bracketed tag like "[tool:...]".
      // Some models may imitate that format and emit fake tool calls as plain text.
      // Use a neutral, informational format instead.
      parts.push(`\n\nTool ${name} (${status}): ${safeJson(payload)}\n\n`);
      continue;
    }
  }

  // Fallback to raw if blocks were empty (but never crash).
  if (parts.length === 0 && typeof msg.raw === "string") return msg.raw;
  return parts.join("");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export type OpenAICompatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string };

export function buildTruncatedContext(
  history: StoredMessage[],
  tokenLimit: number
): { messages: OpenAICompatMessage[]; usedTokens: number; dropped: number } {
  const limit = clampInt(tokenLimit, 256, 1_000_000);

  // Keep the last system message (if any) as an anchor.
  let systemMsg: OpenAICompatMessage | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "system") {
      systemMsg = { role: "system", content: messageToVisibleText(history[i]) };
      break;
    }
  }

  const items: Array<{ role: OpenAICompatMessage["role"]; content: string; tokens: number }> = [];

  for (const m of history) {
    if (!m || typeof m.role !== "string") continue;
    if (m.role === "system") continue; // handled separately

    const role =
      m.role === "user" || m.role === "assistant" || m.role === "tool" ? (m.role as any) : "user";
    const content = messageToVisibleText(m);
    const tokens = estimateTokens(content) + 4; // small per-message overhead
    items.push({ role, content, tokens });
  }

  // Select from the end until token budget is satisfied.
  const selected: typeof items = [];
  let used = systemMsg ? estimateTokens(systemMsg.content) + 8 : 0;

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (selected.length === 0) {
      // Always keep the last message.
      selected.push(it);
      used += it.tokens;
      continue;
    }
    if (used + it.tokens > limit) continue;
    selected.push(it);
    used += it.tokens;
  }

  selected.reverse();

  const out: OpenAICompatMessage[] = [];
  if (systemMsg) out.push(systemMsg);
  for (const it of selected) out.push({ role: it.role, content: it.content });

  const dropped = items.length - selected.length;
  return { messages: out, usedTokens: used, dropped };
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}
