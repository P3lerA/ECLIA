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

export async function checkModelCached(model: string): Promise<boolean | null> {
  const data = await memoryApiFetch(`/embeddings/status?model=${encodeURIComponent(model)}`);
  if (!data || data.ok !== true) return null;
  return Boolean(data.cached);
}

export async function downloadModel(model: string): Promise<{ ok: boolean; error?: string }> {
  const data = await memoryApiFetch("/embeddings/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model })
  });
  if (!data) return { ok: false, error: "Memory service unreachable" };
  return { ok: Boolean(data.ok), error: data.error };
}

export async function deleteModel(model: string): Promise<{ ok: boolean; error?: string }> {
  const data = await memoryApiFetch("/embeddings/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model })
  });
  if (!data) return { ok: false, error: "Memory service unreachable" };
  return { ok: Boolean(data.ok), error: data.error };
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

export async function createMemory(args: { raw: string; strength: number }): Promise<MemoryManageItem | null> {
  const data = await memoryApiFetch("/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: args.raw, strength: args.strength })
  });
  if (!data || data.ok !== true) return null;

  const memory = data.memory ?? null;
  if (!memory) return null;

  return mapMemoryManageItem(memory);
}

export async function updateMemory(args: { id: string; raw: string; strength: number }): Promise<MemoryManageItem | null> {
  const id = args.id.trim();
  if (!id) return null;

  const data = await memoryApiFetch(`/memories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: args.raw, strength: args.strength })
  });
  if (!data || data.ok !== true) return null;

  const memory = data.memory ?? null;
  if (!memory) return null;

  return mapMemoryManageItem(memory);
}

export type GenesisStatus = {
  active: { id: string; stage: string; processedSessions: number; processedChunks: number; extractedFacts: number } | null;
  last: { id: string; stage: string; processedSessions: number; processedChunks: number; extractedFacts: number; error?: string } | null;
};

export async function startGenesis(opts?: { model?: string }): Promise<{ ok: boolean; error?: string }> {
  const data = await memoryApiFetch("/genesis/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {})
  });
  if (!data) return { ok: false, error: "Memory service unreachable" };
  return { ok: Boolean(data.ok), error: data.error };
}

export async function fetchGenesisStatus(): Promise<GenesisStatus | null> {
  const data = await memoryApiFetch("/genesis/status");
  if (!data || data.ok !== true) return null;
  const s = data.status ?? {};
  return {
    active: s.active ?? null,
    last: s.last ?? null
  };
}

export async function deleteMemoryItem(id: string): Promise<boolean> {
  const clean = id.trim();
  if (!clean) return false;

  const data = await memoryApiFetch(`/memories/${encodeURIComponent(clean)}`, { method: "DELETE" });
  return Boolean(data?.ok);
}
