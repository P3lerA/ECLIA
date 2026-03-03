import http from "node:http";

import {
  readSystemMemoryEmitTemplate,
  renderSystemMemoryEmitTemplate,
  loadEcliaConfig
} from "@eclia/config";

import { json, readJson, asString, clampInt } from "../httpUtils.js";
import { ensureGatewaySession, guessGatewayUrl, runGatewayChat, withGatewayAuth } from "../../../adapter/gateway.js";

type TranscriptRecordV1 = any;

type OpenAICompatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: any;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any;
};

function transcriptRecordsToMessages(records: TranscriptRecordV1[]): OpenAICompatMessage[] {
  const out: OpenAICompatMessage[] = [];
  const rows = Array.isArray(records) ? records : [];
  for (const r of rows) {
    if (!r || (r as any).v !== 1) continue;
    if ((r as any).type === "reset") {
      out.length = 0;
      continue;
    }
    if ((r as any).type === "msg" && (r as any).msg && typeof (r as any).msg.role === "string") {
      out.push((r as any).msg as OpenAICompatMessage);
    }
  }
  return out;
}

function groupTurns(messages: OpenAICompatMessage[]): OpenAICompatMessage[][] {
  const groups: OpenAICompatMessage[][] = [];
  let cur: OpenAICompatMessage[] = [];

  const flush = () => {
    if (!cur.length) return;
    groups.push(cur);
    cur = [];
  };

  for (const m of messages) {
    if (!m) continue;
    if (m.role === "user") flush();
    cur.push(m);
  }
  flush();
  return groups;
}

function takeLastNTurns(messages: OpenAICompatMessage[], nTurns: number): OpenAICompatMessage[] {
  const n = Math.max(1, Math.min(64, Math.trunc(nTurns)));
  const groups = groupTurns(messages.filter((m) => m && m.role !== "system"));
  const selected = groups.slice(Math.max(0, groups.length - n));
  return selected.flat();
}

function clipText(s: string, maxChars: number): string {
  const t = typeof s === "string" ? s : "";
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "…";
}

function aggressiveTruncateForEmit(
  messages: OpenAICompatMessage[],
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
  for (const m of messages) {
    if (!m) continue;
    if (m.role === "system") continue;

    if (m.role === "tool") {
      if (toolMessages === "drop") continue;
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      cleaned.push({ ...m, content: toolMaxCharsPerMsg > 0 ? clipText(content, toolMaxCharsPerMsg) : "" });
      continue;
    }

    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    cleaned.push({ ...m, content: clipText(content, maxCharsPerMsg) });
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

async function fetchGatewayTranscript(args: { gatewayUrl: string; sessionId: string; tail: number }): Promise<{ transcript: TranscriptRecordV1[] }> {
  const url = `${args.gatewayUrl}/api/sessions/${encodeURIComponent(args.sessionId)}?tail=${encodeURIComponent(String(args.tail))}`;
  const resp = await fetch(url, { headers: withGatewayAuth({}) });
  const j = (await resp.json().catch(() => null)) as any;
  if (!resp.ok || !j?.ok) {
    throw new Error(`failed_to_fetch_transcript: ${j?.error ?? resp.status}`);
  }
  return { transcript: Array.isArray(j.transcript) ? j.transcript : [] };
}

export async function handleEmitRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJson(req);
  const sourceSessionId = asString((body as any)?.sourceSessionId);
  if (!sourceSessionId.trim()) return json(res, 400, { ok: false, error: "missing_sourceSessionId" });

  const nTurns = clampInt((body as any)?.turns, 1, 64, 10);
  const tail = clampInt((body as any)?.tail, 50, 2000, 400);

  const maxCharsPerMsg = clampInt((body as any)?.maxCharsPerMsg, 64, 10_000, 1200);
  const maxTotalChars = clampInt((body as any)?.maxTotalChars, 256, 200_000, 10_000);

  const gatewayUrl = guessGatewayUrl();

  // Load config early for defaults (tool-output truncation strategy).
  const { rootDir, config } = loadEcliaConfig(process.cwd());
  const emitCfg = ((config as any)?.memory as any)?.emit ?? {};
  const cfgToolMessages = typeof emitCfg?.tool_messages === "string" ? String(emitCfg.tool_messages).trim() : "drop";
  const toolMessages = cfgToolMessages === "truncate" ? "truncate" : "drop";
  const toolMaxCharsPerMsg = clampInt(emitCfg?.tool_max_chars_per_msg, 0, 50_000, 1200);
  const toolMaxTotalChars = clampInt(emitCfg?.tool_max_total_chars, 0, 200_000, 5000);

  // Fetch source transcript (from the gateway store), then prepare a role-structured context.
  const { transcript } = await fetchGatewayTranscript({ gatewayUrl, sessionId: sourceSessionId, tail });
  const allMessages = transcriptRecordsToMessages(transcript);
  const lastTurns = takeLastNTurns(allMessages, nTurns);
  const contextMessages = aggressiveTruncateForEmit(lastTurns, {
    maxCharsPerMsg,
    maxTotalChars,
    toolMessages,
    toolMaxCharsPerMsg,
    toolMaxTotalChars
  });

  // Load system prompt template from _system_memory_emit.local.md (initialized at startup).
  const { text: emitTpl } = readSystemMemoryEmitTemplate(rootDir);
  const systemPrompt = renderSystemMemoryEmitTemplate(emitTpl, {
    userPreferredName: (config as any)?.persona?.user_preferred_name,
    assistantName: (config as any)?.persona?.assistant_name
  });

  // Ensure a stable internal session for audit/debug (doesn't affect context since includeHistory=false).
  const emitterSessionId = "memory-emit";
  try {
    await ensureGatewaySession(gatewayUrl, emitterSessionId, "Memory Emit (internal)", { kind: "memory_emit" });
  } catch {
    // best-effort
  }

  const userText = "在本次会话中值得提取的记忆有哪些？";

  const { text: assistantText, meta } = await runGatewayChat({
    gatewayUrl,
    sessionId: emitterSessionId,
    userText,
    model: typeof (body as any)?.model === "string" ? String((body as any).model) : undefined,
    toolAccessMode: "full",
    streamMode: "final",
    enabledTools: ["memory"],
    includeHistory: false,
    messages: contextMessages as any,
    systemInstructionOverride: systemPrompt,
    skipMemoryRecall: true,
    // Extra aggressive: keep this small to avoid tool noise even if callers forget to strip.
    contextTokenLimit: clampInt((body as any)?.contextTokenLimit, 256, 50_000, 2000)
  });

  return json(res, 200, {
    ok: true,
    sourceSessionId,
    used: {
      turns: nTurns,
      tail,
      maxCharsPerMsg,
      maxTotalChars,
      toolMessages,
      toolMaxCharsPerMsg,
      toolMaxTotalChars,
      contextMessages: contextMessages.length
    },
    gateway: { sessionId: emitterSessionId, meta },
    assistantText
  });
}
