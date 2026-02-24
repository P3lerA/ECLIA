import type { SessionMetaV1 } from "../sessionTypes.js";
import type { OpenAICompatMessage, TranscriptRecordV1 } from "../transcriptTypes.js";

export function deriveTitle(userText: string): string {
  const s = userText.replace(/\s+/g, " ").trim();
  if (!s) return "New session";
  const max = 64;
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

export function firstUserTextInTranscript(messages: OpenAICompatMessage[]): string | null {
  for (const m of messages) {
    if (!m || m.role !== "user") continue;
    const c = (m as any).content;
    const t = typeof c === "string" ? c.trim() : "";
    if (t) return t;
  }
  return null;
}

export function deriveTitleFromOrigin(origin: SessionMetaV1["origin"] | undefined): string | null {
  if (!origin || typeof origin !== "object") return null;
  const kind = typeof (origin as any).kind === "string" ? (origin as any).kind : "";
  if (kind !== "discord") return null;

  const guildName = typeof (origin as any).guildName === "string" ? (origin as any).guildName.trim() : "";
  const channelName = typeof (origin as any).channelName === "string" ? (origin as any).channelName.trim() : "";
  const threadName = typeof (origin as any).threadName === "string" ? (origin as any).threadName.trim() : "";

  const guildId = typeof (origin as any).guildId === "string" ? (origin as any).guildId.trim() : "";
  const channelId = typeof (origin as any).channelId === "string" ? (origin as any).channelId.trim() : "";
  const threadId = typeof (origin as any).threadId === "string" ? (origin as any).threadId.trim() : "";

  const parts: string[] = [];
  parts.push("Discord");

  if (guildName) parts.push(guildName);
  else if (guildId) parts.push(`g${guildId}`);

  if (channelName) parts.push(`#${channelName}`);
  else if (channelId) parts.push(`c${channelId}`);

  if (threadName) parts.push(threadName);
  else if (threadId) parts.push(`t${threadId}`);

  const s = parts.filter(Boolean).join(" · ").trim();
  if (!s) return null;

  // Keep titles short-ish for UI lists.
  return s.length > 96 ? s.slice(0, 96).trimEnd() + "…" : s;
}

export function transcriptRecordsToMessages(records: TranscriptRecordV1[]): OpenAICompatMessage[] {
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

export function extractRequestedOrigin(body: { origin?: unknown }): SessionMetaV1["origin"] | undefined {
  const o = body.origin;
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  if (typeof (o as any).kind !== "string") return undefined;
  return o as any;
}
