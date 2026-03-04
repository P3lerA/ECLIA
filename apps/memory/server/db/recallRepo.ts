import type { MemoryDb, RecallMemoryDto } from "./types.js";
import { toVectorJson } from "./vector.js";

function epochNowSec(): number {
  return Math.trunc(Date.now() / 1000);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export async function recallFacts(args: {
  db: MemoryDb;
  queryVector?: Float32Array | null;
  limit?: number;
  minScore?: number;
}): Promise<RecallMemoryDto[]> {
  const limit = clampInt(args.limit, 0, 200, 20);
  const minScore = typeof args.minScore === "number" && Number.isFinite(args.minScore) ? args.minScore : 0;
  const q = args.queryVector && args.queryVector.length ? toVectorJson(args.queryVector) : null;

  if (q) {
    try {
      const res = await args.db.client.execute({
        sql: `
          SELECT
            node_id AS id,
            raw,
            (1 - vector_distance_cos(vector_S, vector32(?))) AS score
          FROM Fact
          WHERE vector_S IS NOT NULL
          ORDER BY vector_distance_cos(vector_S, vector32(?)) ASC
          LIMIT ?;
        `,
        args: [q, q, limit]
      });

      console.log(`[memory] recallFacts: minScore=${minScore} vector query returned ${res.rows.length} rows, first score raw:`, res.rows[0] ? { score: (res.rows[0] as any).score, type: typeof (res.rows[0] as any).score } : "none");

      const rows = res.rows
        .map((r: any) => ({
          id: asStr(r?.id).trim(),
          raw: asStr(r?.raw),
          score: typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : Number(r?.score)
        }))
        .filter((m) => m.id && m.raw.trim())
        .map((m) => ({ ...m, score: Number.isFinite(m.score) ? m.score : null }))
        .filter((m) => m.score === null || m.score >= minScore);

      // Vector search succeeded — return results (may be empty if all below minScore).
      return rows;
    } catch (err) {
      console.error(`[memory] recallFacts: vector query FAILED:`, err);
    }
  }

  // No query vector or vector query failed — return empty (don't inject unscored memories).
  return [];
}

export async function logActivation(args: {
  db: MemoryDb;
  /** Unix timestamp in seconds. Defaults to now. */
  timestampSec?: number;
  nodes: Array<{ nodeId: string; strength: number }>;
}): Promise<void> {
  const nodes = Array.isArray(args.nodes) ? args.nodes : [];
  if (!nodes.length) return;

  const ts = (() => {
    const n = args.timestampSec;
    const sec = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : epochNowSec();
    return String(sec);
  })();
  const tx = await args.db.client.transaction("write");

  try {
    const a = await tx.execute({
      sql: "INSERT INTO Activation (timestamp) VALUES (?);",
      args: [ts]
    });
    const activationId = Number(a.lastInsertRowid ?? 0);

    for (const n of nodes) {
      const nodeId = String(n.nodeId ?? "").trim();
      if (!nodeId) continue;
      const strength = Number.isFinite(n.strength) ? Number(n.strength) : 0;
      await tx.execute({
        sql: "INSERT INTO Activation_Nodes (activation_id, node_id, strength) VALUES (?, ?, ?);",
        args: [activationId, nodeId, strength]
      });
    }

    await tx.commit();
  } catch {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
  } finally {
    try {
      await tx.close();
    } catch {
      // ignore
    }
  }
}

export function makeFactNodeId(id: string | number): string {
  return `fact:${String(id)}`;
}
