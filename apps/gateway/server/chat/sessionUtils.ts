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
    if (!r || r.v !== 1) continue;
    if (r.type === "reset") {
      out.length = 0;
      continue;
    }
    if (r.type === "msg" && r.msg && typeof r.msg.role === "string") {
      out.push(r.msg);
    }
    // computer_use "done" step → synthesize an assistant message for context continuity.
    if (r.type === "computer_use" && r.step.kind === "done") {
      const text = r.step.assistantText;
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
