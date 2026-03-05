import { readSystemMemoryExtractTemplate, renderSystemMemoryExtractTemplate } from "@eclia/config";

import { clampInt } from "@eclia/utils";
import { withGatewayAuth, type TranscriptRecordV1, type OpenAICompatMessage } from "@eclia/gateway-client";

export type { TranscriptRecordV1, OpenAICompatMessage };

export type TimedMessage = {
  tsSec: number;
  msg: OpenAICompatMessage;
};

export function transcriptRecordsToTimedMessages(records: TranscriptRecordV1[]): TimedMessage[] {
  const out: TimedMessage[] = [];
  const rows = Array.isArray(records) ? records : [];
  for (const r of rows) {
    if (!r || (r as any).v !== 1) continue;
    if ((r as any).type === "reset") {
      out.length = 0;
      continue;
    }
    if ((r as any).type === "msg" && (r as any).msg && typeof (r as any).msg.role === "string") {
      const ts = Number((r as any).ts);
      // Gateway stores transcript timestamps as Date.now() milliseconds.
      // The memory extractor works in integer seconds.
      let tsSec = Number.isFinite(ts) ? Math.trunc(ts) : 0;
      if (tsSec > 100_000_000_000) tsSec = Math.trunc(tsSec / 1000);
      out.push({ tsSec, msg: (r as any).msg as OpenAICompatMessage });
    }
  }
  return out;
}

export function groupTurns(messages: TimedMessage[]): TimedMessage[][] {
  const groups: TimedMessage[][] = [];
  let cur: TimedMessage[] = [];

  const flush = () => {
    if (!cur.length) return;
    groups.push(cur);
    cur = [];
  };

  for (const m of messages) {
    if (!m || !m.msg) continue;
    if (m.msg.role === "user") flush();
    cur.push(m);
  }
  flush();
  return groups;
}

export function takeLastNTurns(messages: TimedMessage[], nTurns: number): TimedMessage[] {
  const n = Math.max(1, Math.min(64, Math.trunc(nTurns)));
  const groups = groupTurns(messages.filter((m) => m && m.msg && m.msg.role !== "system"));
  const selected = groups.slice(Math.max(0, groups.length - n));
  return selected.flat();
}

export function chunkTurns(groups: TimedMessage[][], turnsPerChunk: number): TimedMessage[][] {
  const per = clampInt(turnsPerChunk, 1, 64, 20);
  if (!groups.length) return [];
  const chunks: TimedMessage[][] = [];
  for (let i = 0; i < groups.length; i += per) {
    chunks.push(groups.slice(i, i + per).flat());
  }
  return chunks;
}

function clipText(s: string, maxChars: number): string {
  const t = typeof s === "string" ? s : "";
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "…";
}

function stringifyContent(content: any): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content ?? "");
  } catch {
    return String(content ?? "");
  }
}

function withTsPrefix(tsSec: number, text: string): string {
  const t = Number.isFinite(tsSec) && tsSec > 0 ? Math.trunc(tsSec) : 0;
  return t > 0 ? `[t=${t}] ${text}` : text;
}

export function aggressiveTruncateForExtract(
  messages: TimedMessage[],
  opts: {
    maxCharsPerMsg: number;
    maxTotalChars: number;
    toolMessages: "drop" | "truncate";
    toolMaxCharsPerMsg: number;
    toolMaxTotalChars: number;
  }
): OpenAICompatMessage[] {
  const maxCharsPerMsg = Math.max(64, Math.min(50_000, Math.trunc(opts.maxCharsPerMsg)));
  const maxTotalChars = Math.max(256, Math.min(200_000, Math.trunc(opts.maxTotalChars)));

  const toolMessages = opts.toolMessages === "truncate" ? "truncate" : "drop";
  const toolMaxCharsPerMsg = Math.max(0, Math.min(50_000, Math.trunc(opts.toolMaxCharsPerMsg)));
  const toolMaxTotalChars = Math.max(0, Math.min(200_000, Math.trunc(opts.toolMaxTotalChars)));

  // Drop tool outputs by default (too noisy); optionally keep them with aggressive clipping.
  const cleaned: OpenAICompatMessage[] = [];
  for (const tm of messages) {
    if (!tm || !tm.msg) continue;
    const m = tm.msg;
    if (m.role === "system") continue;

    if (m.role === "tool") {
      if (toolMessages === "drop") continue;
      const content = stringifyContent(m.content);
      const clipped = toolMaxCharsPerMsg > 0 ? clipText(content, toolMaxCharsPerMsg) : "";
      cleaned.push({ ...m, content: withTsPrefix(tm.tsSec, clipped) });
      continue;
    }

    const content = stringifyContent(m.content);
    cleaned.push({ ...m, content: withTsPrefix(tm.tsSec, clipText(content, maxCharsPerMsg)) });
  }

  // Hard cap total size (and tool contribution), keeping tail.
  let total = 0;
  let toolTotal = 0;
  const out: OpenAICompatMessage[] = [];
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const m = cleaned[i];
    const len = typeof m.content === "string" ? m.content.length : 0;
    if (out.length === 0) {
      out.push(m);
      total += len;
      if (m.role === "tool") toolTotal += len;
      continue;
    }
    if (m.role === "tool" && toolMaxTotalChars > 0 && toolTotal + len > toolMaxTotalChars) continue;
    if (total + len > maxTotalChars) continue;
    out.push(m);
    total += len;
    if (m.role === "tool") toolTotal += len;
  }
  out.reverse();
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers used by both extractHandlers and genesisHandlers
// ---------------------------------------------------------------------------

export async function fetchGatewayTranscript(args: {
  gatewayUrl: string;
  sessionId: string;
  tail: number;
}): Promise<{ transcript: TranscriptRecordV1[] }> {
  const url = `${args.gatewayUrl}/api/sessions/${encodeURIComponent(args.sessionId)}?tail=${encodeURIComponent(String(args.tail))}`;
  const resp = await fetch(url, { headers: withGatewayAuth({}) });
  const j = (await resp.json().catch(() => null)) as any;
  if (!resp.ok || !j?.ok) {
    throw new Error(`failed_to_fetch_transcript: ${args.sessionId}: ${j?.error ?? resp.status}`);
  }
  return { transcript: Array.isArray(j.transcript) ? j.transcript : [] };
}

export function loadExtractToolConfig(config: any): {
  toolMessages: "drop" | "truncate";
  toolMaxCharsPerMsg: number;
  toolMaxTotalChars: number;
} {
  const extractCfg = config?.memory?.extract ?? {};
  const cfgToolMessages = typeof extractCfg?.tool_messages === "string" ? String(extractCfg.tool_messages).trim() : "drop";
  return {
    toolMessages: cfgToolMessages === "truncate" ? "truncate" : "drop",
    toolMaxCharsPerMsg: clampInt(extractCfg?.tool_max_chars_per_msg, 0, 50_000, 1200),
    toolMaxTotalChars: clampInt(extractCfg?.tool_max_total_chars, 0, 200_000, 5000)
  };
}

export function buildExtractSystemPrompt(rootDir: string, config: any): string {
  const { text: tpl } = readSystemMemoryExtractTemplate(rootDir);
  return renderSystemMemoryExtractTemplate(tpl, {
    userPreferredName: config?.persona?.user_preferred_name,
    assistantName: config?.persona?.assistant_name
  });
}
