import type { EmbeddingLanguage, MemoryBase, MemoryDraft, MemoryManageItem } from "./memoryTypes";
import { EMBEDDING_MODELS } from "./memoryTypes";

function asStr(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** Infer language category from a model name. */
export function inferLanguage(model: string): EmbeddingLanguage {
  for (const lang of ["zh", "multi", "en"] as EmbeddingLanguage[]) {
    if (EMBEDDING_MODELS[lang].some((m) => m.value === model)) return lang;
  }

  const lower = model.toLowerCase();
  if (lower.includes("chinese") || lower.includes("text2vec")) return "zh";
  if (lower.includes("multilingual") || lower.includes("multi-")) return "multi";
  return "en";
}

export function formatTs(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function memoryTitle(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "(empty)";
  return t.length > 68 ? `${t.slice(0, 68)}…` : t;
}

export function parseStrength(s: string): number | null {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

export function intOrNull(s: string, min: number, max: number): number | null {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < min || i > max) return null;
  return i;
}

export function readMemoryBase(cfg: any): MemoryBase {
  const mem = (cfg as any)?.memory ?? {};
  const genesis = (mem as any)?.genesis ?? {};
  const emit = (mem as any)?.emit ?? {};

  const enabled = Boolean(mem?.enabled ?? false);
  const host = asStr(mem?.host).trim() || "127.0.0.1";

  const portRaw = Number(asStr(mem?.port));
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 8788;

  const recentTurnsRaw = Number(asStr(mem?.recent_turns));
  const recentTurns = Number.isFinite(recentTurnsRaw) ? Math.trunc(recentTurnsRaw) : 8;

  const recallLimitRaw = Number(asStr(mem?.recall_limit));
  const recallLimit = Number.isFinite(recallLimitRaw) ? Math.trunc(recallLimitRaw) : 20;

  const timeoutRaw = Number(asStr(mem?.timeout_ms));
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.trunc(timeoutRaw) : 1200;

  const embModel = asStr(mem?.embeddings?.model).trim() || "all-MiniLM-L6-v2";

  const genesisTurnsRaw = Number(asStr((genesis as any)?.turns_per_call));
  const genesisTurnsPerCall = Number.isFinite(genesisTurnsRaw) ? Math.trunc(genesisTurnsRaw) : 20;

  const toolMessagesRaw = typeof (emit as any)?.tool_messages === "string" ? String((emit as any).tool_messages).trim() : "";
  const emitToolMessages: any = toolMessagesRaw === "truncate" || toolMessagesRaw === "drop" ? toolMessagesRaw : "drop";

  const toolMaxCharsRaw = Number(asStr((emit as any)?.tool_max_chars_per_msg));
  const emitToolMaxCharsPerMsg = Number.isFinite(toolMaxCharsRaw) ? Math.trunc(toolMaxCharsRaw) : 1200;

  const toolMaxTotalRaw = Number(asStr((emit as any)?.tool_max_total_chars));
  const emitToolMaxTotalChars = Number.isFinite(toolMaxTotalRaw) ? Math.trunc(toolMaxTotalRaw) : 5000;

  return {
    enabled,
    host,
    port,
    recentTurns,
    recallLimit,
    timeoutMs,
    embeddingsModel: embModel,
    genesisTurnsPerCall,
    emitToolMessages,
    emitToolMaxCharsPerMsg,
    emitToolMaxTotalChars
  };
}

export function baseToDraft(base: MemoryBase): MemoryDraft {
  return {
    enabled: base.enabled,
    host: base.host,
    port: String(base.port),
    recentTurns: String(base.recentTurns),
    recallLimit: String(base.recallLimit),
    timeoutMs: String(base.timeoutMs),
    embeddingsModel: String(base.embeddingsModel ?? "").trim() || "all-MiniLM-L6-v2",
    genesisTurnsPerCall: String(base.genesisTurnsPerCall ?? 20),
    emitToolMessages: base.emitToolMessages ?? "drop",
    emitToolMaxCharsPerMsg: String(base.emitToolMaxCharsPerMsg ?? 1200),
    emitToolMaxTotalChars: String(base.emitToolMaxTotalChars ?? 5000)
  };
}

export function mapMemoryManageItem(row: any): MemoryManageItem {
  return {
    id: asStr(row?.id).trim(),
    raw: asStr(row?.raw),
    createdAt: Number(row?.createdAt) || 0,
    updatedAt: Number(row?.updatedAt) || 0,
    strength: Number(row?.strength) || 0
  };
}
