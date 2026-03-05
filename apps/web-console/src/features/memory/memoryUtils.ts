import type { EmbeddingLanguage, MemoryBase, MemoryDraft, MemoryManageItem } from "./memoryTypes";
import { EMBEDDING_MODELS } from "./memoryTypes";
import { asString } from "@eclia/utils";

/** Infer language category from a model name. */
export function inferLanguage(model: string): EmbeddingLanguage {
  for (const lang of ["zh", "multi", "en"] as EmbeddingLanguage[]) {
    if (EMBEDDING_MODELS[lang].some((m) => m.value === model)) return lang;
  }

  const lower = model.toLowerCase();
  if (lower.includes("chinese") || lower.includes("text2vec")) return "zh";
  if (lower.includes("multilingual") || lower.includes("multi-") || lower.includes("bge-m3")) return "multi";
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

export function floatOrNull(s: string, min: number, max: number): number | null {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

export function readMemoryBase(cfg: any): MemoryBase {
  const mem = (cfg as any)?.memory ?? {};
  const genesis = (mem as any)?.genesis ?? {};
  const extract = (mem as any)?.extract ?? {};

  const enabled = Boolean(mem?.enabled ?? false);
  const host = asString(mem?.host).trim() || "127.0.0.1";

  const portRaw = Number(asString(mem?.port));
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 8788;

  const recentTurnsRaw = Number(asString(mem?.recent_turns));
  const recentTurns = Number.isFinite(recentTurnsRaw) ? Math.trunc(recentTurnsRaw) : 8;

  const recallLimitRaw = Number(asString(mem?.recall_limit));
  const recallLimit = Number.isFinite(recallLimitRaw) ? Math.trunc(recallLimitRaw) : 20;

  const recallMinScoreRaw = Number(mem?.recall_min_score ?? "");
  const recallMinScore = Number.isFinite(recallMinScoreRaw) ? recallMinScoreRaw : 0.6;

  const timeoutRaw = Number(asString(mem?.timeout_ms));
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.trunc(timeoutRaw) : 1200;

  const embModel = asString(mem?.embeddings?.model).trim() || "all-MiniLM-L6-v2";

  const genesisTurnsRaw = Number(asString((genesis as any)?.turns_per_call));
  const genesisTurnsPerCall = Number.isFinite(genesisTurnsRaw) ? Math.trunc(genesisTurnsRaw) : 20;

  const toolMessagesRaw = typeof (extract as any)?.tool_messages === "string" ? String((extract as any).tool_messages).trim() : "";
  const extractToolMessages: any = toolMessagesRaw === "truncate" || toolMessagesRaw === "drop" ? toolMessagesRaw : "drop";

  const toolMaxCharsRaw = Number(asString((extract as any)?.tool_max_chars_per_msg));
  const extractToolMaxCharsPerMsg = Number.isFinite(toolMaxCharsRaw) ? Math.trunc(toolMaxCharsRaw) : 1200;

  const toolMaxTotalRaw = Number(asString((extract as any)?.tool_max_total_chars));
  const extractToolMaxTotalChars = Number.isFinite(toolMaxTotalRaw) ? Math.trunc(toolMaxTotalRaw) : 5000;

  return {
    enabled,
    host,
    port,
    recentTurns,
    recallLimit,
    recallMinScore,
    timeoutMs,
    embeddingsModel: embModel,
    genesisTurnsPerCall,
    extractToolMessages,
    extractToolMaxCharsPerMsg,
    extractToolMaxTotalChars
  };
}

export function baseToDraft(base: MemoryBase): MemoryDraft {
  return {
    enabled: base.enabled,
    host: base.host,
    port: String(base.port),
    recentTurns: String(base.recentTurns),
    recallLimit: String(base.recallLimit),
    recallMinScore: String(base.recallMinScore),
    timeoutMs: String(base.timeoutMs),
    embeddingsModel: String(base.embeddingsModel ?? "").trim() || "all-MiniLM-L6-v2",
    genesisTurnsPerCall: String(base.genesisTurnsPerCall ?? 20),
    extractToolMessages: base.extractToolMessages ?? "drop",
    extractToolMaxCharsPerMsg: String(base.extractToolMaxCharsPerMsg ?? 1200),
    extractToolMaxTotalChars: String(base.extractToolMaxTotalChars ?? 5000)
  };
}

export function mapMemoryManageItem(row: any): MemoryManageItem {
  return {
    id: asString(row?.id).trim(),
    raw: asString(row?.raw),
    createdAt: Number(row?.createdAt) || 0,
    updatedAt: Number(row?.updatedAt) || 0,
    strength: Number(row?.strength) || 0,
    activationCount: Number(row?.activationCount) || 0,
    lastActivatedAt: Number(row?.lastActivatedAt) || 0,
    originSession: asString(row?.originSession)
  };
}
