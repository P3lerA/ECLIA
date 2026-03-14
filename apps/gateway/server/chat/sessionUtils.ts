import type { SessionMetaV1 } from "../sessionTypes.js";
import type { OpenAICompatMessage, TranscriptRecordV1 } from "../transcriptTypes.js";
import { deriveTitleFromOriginByKind } from "./titleFormatters/index.js";

export function deriveTitle(userText: string): string {
  const s = userText.replace(/\s+/g, " ").trim();
  if (!s) return "New session";
  const max = 64;
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

export function deriveTitleFromOrigin(origin: SessionMetaV1["origin"] | undefined): string | null {
  return deriveTitleFromOriginByKind(origin);
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
    // computer_use "done" step → synthesize an assistant message for context continuity.
    if ((r as any).type === "computer_use" && (r as any).step?.kind === "done") {
      const text = typeof (r as any).step.assistantText === "string" ? (r as any).step.assistantText : "";
      if (text) out.push({ role: "assistant", content: text });
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
