import type { Block, BlockOrigin } from "./sessionTypes.js";

export function inferVendorFromBaseUrl(baseUrl: string): string | undefined {
  const u = (baseUrl ?? "").toLowerCase();
  if (!u) return undefined;
  if (u.includes("minimax")) return "minimax";
  if (u.includes("openai")) return "openai";
  if (u.includes("anthropic")) return "anthropic";
  if (u.includes("googleapis") || u.includes("generativelanguage")) return "google";
  return "custom";
}

/**
 * Split <think>...</think> segments from a raw text (best-effort).
 * We keep both:
 * - raw = original string (stored as-is)
 * - blocks = thought + visible text blocks
 */
export function splitThink(raw: string): { thoughts: string[]; visible: string } {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return { thoughts: [], visible: "" };

  const re = /<think>([\s\S]*?)<\/think>/gi;
  const thoughts: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(s))) {
    const inner = (m[1] ?? "").trim();
    if (inner) thoughts.push(inner);
  }

  const visible = s.replace(re, "").trim();
  return { thoughts, visible };
}

export function blocksFromAssistantRaw(raw: string, origin: BlockOrigin): Block[] {
  const { thoughts, visible } = splitThink(raw);

  const blocks: Block[] = [];
  for (const t of thoughts) {
    blocks.push({ type: "thought", text: t, visibility: "internal", origin });
  }

  if (visible) blocks.push({ type: "text", text: visible, origin });
  if (!blocks.length) blocks.push({ type: "text", text: "", origin });

  return blocks;
}

export function textBlock(text: string, origin?: BlockOrigin): Block {
  return { type: "text", text, origin };
}
