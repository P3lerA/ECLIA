import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { MemoryStore, MemoryFact, ManagedMemoryDto } from "./types.js";

function isoNow(): string {
  return new Date().toISOString();
}

function parseIsoMs(v: string): number {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function toDto(f: MemoryFact): ManagedMemoryDto {
  return {
    id: String(f.id),
    raw: f.raw,
    createdAt: parseIsoMs(f.createdAt),
    updatedAt: parseIsoMs(f.updatedAt),
  };
}

export type JsonMemoryStore = {
  /** All facts (full list). */
  allFacts(): ManagedMemoryDto[];
  /** Paginated + optional text search. */
  listFacts(q?: string, offset?: number, limit?: number): { facts: ManagedMemoryDto[]; total: number };
  /** Create a new fact, returns it. */
  createFact(raw: string): Promise<ManagedMemoryDto>;
  /** Update an existing fact's text, returns updated or null. */
  updateFact(id: string, raw: string): Promise<ManagedMemoryDto | null>;
  /** Delete a fact by id. */
  deleteFact(id: string): Promise<boolean>;
  /** Path to the JSON file. */
  filePath: string;
};

function clamp(v: number | undefined, min: number, max: number, def: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

export async function openJsonStore(rootDir: string): Promise<JsonMemoryStore> {
  const dir = path.join(rootDir, ".eclia", "memory");
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, "profile.json");

  let data: MemoryStore;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    data = {
      nextId: typeof parsed.nextId === "number" ? parsed.nextId : 1,
      facts: Array.isArray(parsed.facts) ? parsed.facts.filter((f: any) => f && typeof f.id === "number" && typeof f.raw === "string") : [],
    };
  } catch {
    data = { nextId: 1, facts: [] };
  }

  // Migrate from libSQL if profile.json doesn't exist but memory.db does
  if (data.facts.length === 0) {
    const legacyDb = path.join(dir, "memory.db");
    if (fs.existsSync(legacyDb)) {
      console.log("[memory] found legacy memory.db — attempting migration to profile.json");
      try {
        data = await migrateFromSqlite(legacyDb);
        console.log(`[memory] migrated ${data.facts.length} facts from memory.db`);
      } catch (err) {
        console.warn("[memory] migration from memory.db failed:", err);
        data = { nextId: 1, facts: [] };
      }
    }
  }

  let writing = false;
  async function persist() {
    if (writing) return;
    writing = true;
    try {
      await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    } finally {
      writing = false;
    }
  }

  // Initial write to ensure file exists
  await persist();

  return {
    filePath,

    allFacts() {
      return data.facts.map(toDto);
    },

    listFacts(q?: string, offset?: number, limit?: number) {
      const query = (q ?? "").trim().toLowerCase();
      const filtered = query
        ? data.facts.filter((f) => f.raw.toLowerCase().includes(query))
        : data.facts;
      const total = filtered.length;
      const off = clamp(offset, 0, 1_000_000, 0);
      const lim = clamp(limit, 1, 500, 200);
      // newest first
      const sorted = [...filtered].sort((a, b) => parseIsoMs(b.createdAt) - parseIsoMs(a.createdAt) || b.id - a.id);
      const page = sorted.slice(off, off + lim);
      return { facts: page.map(toDto), total };
    },

    async createFact(raw: string) {
      const ts = isoNow();
      const fact: MemoryFact = { id: data.nextId++, raw: raw.trim(), createdAt: ts, updatedAt: ts };
      data.facts.push(fact);
      await persist();
      return toDto(fact);
    },

    async updateFact(id: string, raw: string) {
      const idNum = Number(id);
      const fact = data.facts.find((f) => f.id === idNum);
      if (!fact) return null;
      fact.raw = raw.trim();
      fact.updatedAt = isoNow();
      await persist();
      return toDto(fact);
    },

    async deleteFact(id: string) {
      const idNum = Number(id);
      const idx = data.facts.findIndex((f) => f.id === idNum);
      if (idx < 0) return false;
      data.facts.splice(idx, 1);
      await persist();
      return true;
    },

  };
}

async function migrateFromSqlite(dbPath: string): Promise<MemoryStore> {
  // Dynamic import to avoid hard dependency — only used for one-time migration
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${dbPath.replace(/\\/g, "/")}` });

  const res = await client.execute("SELECT node_id, raw FROM Fact WHERE raw IS NOT NULL AND raw != '' ORDER BY node_id ASC;");

  const facts: MemoryFact[] = [];
  let maxId = 0;
  const ts = new Date().toISOString();
  for (const row of res.rows) {
    const id = Number(row.node_id);
    const raw = String(row.raw ?? "").trim();
    if (!raw || !Number.isFinite(id)) continue;
    facts.push({ id, raw, createdAt: ts, updatedAt: ts });
    if (id > maxId) maxId = id;
  }

  client.close();
  return { nextId: maxId + 1, facts };
}
