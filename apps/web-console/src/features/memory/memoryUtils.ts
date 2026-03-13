import type { MemoryManageItem } from "./memoryTypes";
import { asString } from "@eclia/utils";

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

export function mapMemoryManageItem(row: any): MemoryManageItem {
  return {
    id: asString(row?.id).trim(),
    raw: asString(row?.raw),
    createdAt: Number(row?.createdAt) || 0,
    updatedAt: Number(row?.updatedAt) || 0,
  };
}
