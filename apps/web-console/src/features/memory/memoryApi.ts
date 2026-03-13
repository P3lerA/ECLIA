import { apiFetch } from "../../core/api/apiFetch";
import type { MemoryManageItem } from "./memoryTypes";
import { mapMemoryManageItem } from "./memoryUtils";

async function memoryApiFetch(path: string, init?: RequestInit): Promise<any | null> {
  try {
    const resp = await apiFetch(`/api/memory${path}`, {
      ...init,
      signal: AbortSignal.timeout(init?.method === "POST" ? 630_000 : 8_000)
    });
    return await resp.json();
  } catch {
    return null;
  }
}

export async function listMemories(args: { q: string; limit: number; offset: number }): Promise<MemoryManageItem[] | null> {
  const q = args.q.trim();
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  qs.set("limit", String(args.limit));
  qs.set("offset", String(args.offset));

  const data = await memoryApiFetch(`/memories?${qs.toString()}`);
  if (!data || data.ok !== true) return null;

  const rows = Array.isArray(data.memories) ? (data.memories as any[]) : [];
  return rows
    .map((row) => mapMemoryManageItem(row))
    .filter((item) => item.id && item.raw.trim());
}

export async function createMemory(args: { raw: string }): Promise<MemoryManageItem | null> {
  const data = await memoryApiFetch("/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: args.raw })
  });
  if (!data || data.ok !== true) return null;

  const memory = data.memory ?? null;
  if (!memory) return null;

  return mapMemoryManageItem(memory);
}

export async function updateMemory(args: { id: string; raw: string }): Promise<MemoryManageItem | null> {
  const id = args.id.trim();
  if (!id) return null;

  const data = await memoryApiFetch(`/memories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: args.raw })
  });
  if (!data || data.ok !== true) return null;

  const memory = data.memory ?? null;
  if (!memory) return null;

  return mapMemoryManageItem(memory);
}

export async function deleteMemoryItem(id: string): Promise<boolean> {
  const clean = id.trim();
  if (!clean) return false;

  const data = await memoryApiFetch(`/memories/${encodeURIComponent(clean)}`, { method: "DELETE" });
  return Boolean(data?.ok);
}
