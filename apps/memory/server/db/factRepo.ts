import type { ManagedMemoryDto, MemoryDb } from "./types.js";
import { makeRandomUnitVector, parseVectorJson, R_DIM, scaleVectorToNorm, toVectorJson, ZERO_R_JSON } from "./vector.js";

function isoNow(): string {
  return new Date().toISOString();
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function parseIsoMs(v: unknown): number {
  const s = typeof v === "string" ? v : "";
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function parseEpochSecMs(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) * 1000 : 0;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function toManagedDto(row: any): ManagedMemoryDto {
  const acRaw = row?.activation_count;
  const activationCount = typeof acRaw === "number" ? acRaw : typeof acRaw === "bigint" ? Number(acRaw) : Number(acRaw) || 0;
  return {
    id: asStr(row?.id).trim(),
    raw: asStr(row?.raw),
    createdAt: parseIsoMs(row?.created_ts),
    updatedAt: parseIsoMs(row?.updated_ts),
    strength: typeof row?.strength === "number" && Number.isFinite(row.strength) ? row.strength : Number(row?.strength) || 0,
    activationCount,
    lastActivatedAt: parseEpochSecMs(row?.last_activated_at),
    originSession: asStr(row?.origin_session)
  };
}

export async function listFactsManage(args: {
  db: MemoryDb;
  q?: string;
  offset?: number;
  limit?: number;
}): Promise<ManagedMemoryDto[]> {
  const q = String(args.q ?? "").trim();
  const offset = clampInt(args.offset, 0, 1_000_000, 0);
  const limit = clampInt(args.limit, 0, 500, 200);

  const res = await args.db.client.execute({
    sql: `
      SELECT
        f.node_id AS id,
        f.raw AS raw,
        (SELECT MIN(t.timestamp) FROM Traces t WHERE t.node_id = f.node_id) AS created_ts,
        (SELECT MAX(t.timestamp) FROM Traces t WHERE t.node_id = f.node_id) AS updated_ts,
        COALESCE(vector_distance_l2(f.vector_R, vector32(?)), 0) AS strength,
        (SELECT COUNT(*) FROM Activation_Nodes an WHERE an.node_id = 'fact:' || f.node_id) AS activation_count,
        (SELECT MAX(a.timestamp) FROM Activation a JOIN Activation_Nodes an ON an.activation_id = a.id WHERE an.node_id = 'fact:' || f.node_id) AS last_activated_at,
        (SELECT an2.source_session FROM Activation a2 JOIN Activation_Nodes an2 ON an2.activation_id = a2.id WHERE an2.node_id = 'fact:' || f.node_id ORDER BY a2.timestamp ASC LIMIT 1) AS origin_session
      FROM Fact f
      WHERE (? = '' OR lower(f.raw) LIKE '%' || lower(?) || '%')
      ORDER BY COALESCE(created_ts, '') DESC, f.node_id DESC
      LIMIT ? OFFSET ?;
    `,
    args: [ZERO_R_JSON, q, q, limit, offset]
  });

  return res.rows.map(toManagedDto).filter((m) => m.id && m.raw.trim());
}

export async function createFact(args: {
  db: MemoryDb;
  raw: string;
  strength?: number;
  vectorS?: Float32Array | null;
}): Promise<ManagedMemoryDto> {
  const raw = String(args.raw ?? "").trim();
  if (!raw) throw new Error("raw is required");

  const strength = typeof args.strength === "number" && Number.isFinite(args.strength) ? args.strength : 1;
  const r = makeRandomUnitVector(R_DIM);
  scaleVectorToNorm(r, strength);

  const ts = isoNow();
  const rJson = toVectorJson(r);
  const sJson = args.vectorS && args.vectorS.length ? toVectorJson(args.vectorS) : null;

  const tx = await args.db.client.transaction("write");
  try {
    // Fact
    const factRes = await tx.execute({
      sql: sJson
        ? "INSERT INTO Fact (raw, vector_S, vector_R) VALUES (?, vector32(?), vector32(?));"
        : "INSERT INTO Fact (raw, vector_S, vector_R) VALUES (?, NULL, vector32(?));",
      args: sJson ? [raw, sJson, rJson] : [raw, rJson]
    });
    const factId = Number(factRes.lastInsertRowid ?? 0);

    // Trace
    const traceRes = await tx.execute({
      sql: "INSERT INTO Traces (timestamp, type, node_id, node_kind) VALUES (?, 'new', ?, 'fact');",
      args: [ts, factId]
    });
    const traceId = Number(traceRes.lastInsertRowid ?? 0);

    await tx.execute({
      sql: "INSERT INTO Trace_Changes (trace_id, before_raw, after_raw) VALUES (?, NULL, ?);",
      args: [traceId, raw]
    });

    await tx.commit();

    const rows = await args.db.client.execute({
      sql: `
        SELECT
          f.node_id AS id,
          f.raw AS raw,
          (SELECT MIN(t.timestamp) FROM Traces t WHERE t.node_id = f.node_id) AS created_ts,
          (SELECT MAX(t.timestamp) FROM Traces t WHERE t.node_id = f.node_id) AS updated_ts,
          COALESCE(vector_distance_l2(f.vector_R, vector32(?)), 0) AS strength
        FROM Fact f
        WHERE f.node_id = ?
        LIMIT 1;
      `,
      args: [ZERO_R_JSON, factId]
    });

    const row = rows.rows[0];
    if (!row) throw new Error("insert failed");
    return toManagedDto(row);
  } catch (e) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    throw e;
  } finally {
    try {
      await tx.close();
    } catch {
      // ignore
    }
  }
}

export async function updateFact(args: {
  db: MemoryDb;
  id: string;
  patch: { raw?: string; strength?: number; vectorS?: Float32Array | null };
}): Promise<ManagedMemoryDto | null> {
  const idNum = Number(String(args.id ?? "").trim());
  if (!Number.isFinite(idNum) || idNum <= 0) return null;

  const tx = await args.db.client.transaction("write");
  const ts = isoNow();

  try {
    const cur = await tx.execute({
      sql: "SELECT raw, vector_extract(vector_R) AS r_json FROM Fact WHERE node_id = ? LIMIT 1;",
      args: [idNum]
    });
    const row = cur.rows[0];
    if (!row) {
      await tx.rollback();
      return null;
    }

    const beforeRaw = asStr(row.raw);
    const nextRaw = typeof args.patch.raw === "string" ? args.patch.raw.trim() : beforeRaw;

    const strength = typeof args.patch.strength === "number" && Number.isFinite(args.patch.strength) ? args.patch.strength : null;

    // Re-scale r if requested.
    const r = parseVectorJson(asStr(row.r_json), R_DIM);
    if (typeof strength === "number") scaleVectorToNorm(r, strength);
    const rJson = toVectorJson(r);

    // vector_S updates are opt-in and are expected to be computed by the caller.
    const nextS = "vectorS" in args.patch ? args.patch.vectorS : undefined;
    const sJson = nextS && nextS.length ? toVectorJson(nextS) : nextS === null ? null : undefined;

    // Update Fact
    if (sJson === undefined) {
      // Preserve vector_S as-is.
      await tx.execute({
        sql: "UPDATE Fact SET raw = ?, vector_R = vector32(?) WHERE node_id = ?;",
        args: [nextRaw, rJson, idNum]
      });
    } else if (sJson === null) {
      // Explicitly clear vector_S.
      await tx.execute({
        sql: "UPDATE Fact SET raw = ?, vector_S = NULL, vector_R = vector32(?) WHERE node_id = ?;",
        args: [nextRaw, rJson, idNum]
      });
    } else {
      await tx.execute({
        sql: "UPDATE Fact SET raw = ?, vector_S = vector32(?), vector_R = vector32(?) WHERE node_id = ?;",
        args: [nextRaw, sJson, rJson, idNum]
      });
    }

    // Trace
    const traceRes = await tx.execute({
      sql: "INSERT INTO Traces (timestamp, type, node_id, node_kind) VALUES (?, 'upsert', ?, 'fact');",
      args: [ts, idNum]
    });
    const traceId = Number(traceRes.lastInsertRowid ?? 0);

    await tx.execute({
      sql: "INSERT INTO Trace_Changes (trace_id, before_raw, after_raw) VALUES (?, ?, ?);",
      args: [traceId, beforeRaw, nextRaw]
    });

    await tx.commit();

    const rows = await args.db.client.execute({
      sql: `
        SELECT
          f.node_id AS id,
          f.raw AS raw,
          (SELECT MIN(t.timestamp) FROM Traces t WHERE t.node_id = f.node_id) AS created_ts,
          (SELECT MAX(t.timestamp) FROM Traces t WHERE t.node_id = f.node_id) AS updated_ts,
          COALESCE(vector_distance_l2(f.vector_R, vector32(?)), 0) AS strength
        FROM Fact f
        WHERE f.node_id = ?
        LIMIT 1;
      `,
      args: [ZERO_R_JSON, idNum]
    });
    const out = rows.rows[0];
    return out ? toManagedDto(out) : null;
  } catch (e) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    throw e;
  } finally {
    try {
      await tx.close();
    } catch {
      // ignore
    }
  }
}

export async function mergeFacts(args: {
  db: MemoryDb;
  sourceIds: number[];
  raw: string;
  strength?: number;
  vectorS?: Float32Array | null;
}): Promise<{ created: ManagedMemoryDto; deletedIds: number[] }> {
  const sourceIds = args.sourceIds.filter((id) => Number.isFinite(id) && id > 0);
  if (sourceIds.length < 2) throw new Error("mergeFacts requires at least 2 source IDs");

  const raw = String(args.raw ?? "").trim();
  if (!raw) throw new Error("raw is required");

  const strength = typeof args.strength === "number" && Number.isFinite(args.strength) ? args.strength : 1;
  const r = makeRandomUnitVector(R_DIM);
  scaleVectorToNorm(r, strength);

  const ts = isoNow();
  const rJson = toVectorJson(r);
  const sJson = args.vectorS && args.vectorS.length ? toVectorJson(args.vectorS) : null;

  const tx = await args.db.client.transaction("write");
  try {
    // 1. Create new merged fact.
    const factRes = await tx.execute({
      sql: sJson
        ? "INSERT INTO Fact (raw, vector_S, vector_R) VALUES (?, vector32(?), vector32(?));"
        : "INSERT INTO Fact (raw, vector_S, vector_R) VALUES (?, NULL, vector32(?));",
      args: sJson ? [raw, sJson, rJson] : [raw, rJson]
    });
    const newId = Number(factRes.lastInsertRowid ?? 0);
    const newNodeId = `fact:${newId}`;

    // Trace for the new fact.
    const traceRes = await tx.execute({
      sql: "INSERT INTO Traces (timestamp, type, node_id, node_kind) VALUES (?, 'new', ?, 'fact');",
      args: [ts, newId]
    });
    const traceId = Number(traceRes.lastInsertRowid ?? 0);
    await tx.execute({
      sql: "INSERT INTO Trace_Changes (trace_id, before_raw, after_raw) VALUES (?, NULL, ?);",
      args: [traceId, raw]
    });

    // 2. Reassign activation records from source facts to the new fact.
    const oldNodeIds = sourceIds.map((id) => `fact:${id}`);
    const placeholders = oldNodeIds.map(() => "?").join(", ");
    await tx.execute({
      sql: `UPDATE Activation_Nodes SET node_id = ? WHERE node_id IN (${placeholders});`,
      args: [newNodeId, ...oldNodeIds]
    });

    // 3. Delete source facts (with traces).
    const deletedIds: number[] = [];
    for (const srcId of sourceIds) {
      const cur = await tx.execute({
        sql: "SELECT raw FROM Fact WHERE node_id = ? LIMIT 1;",
        args: [srcId]
      });
      const row = cur.rows[0];
      if (!row) continue;

      const beforeRaw = asStr(row.raw);
      const dTraceRes = await tx.execute({
        sql: "INSERT INTO Traces (timestamp, type, node_id, node_kind) VALUES (?, 'delete', ?, 'fact');",
        args: [ts, srcId]
      });
      const dTraceId = Number(dTraceRes.lastInsertRowid ?? 0);
      await tx.execute({
        sql: "INSERT INTO Trace_Changes (trace_id, before_raw, after_raw) VALUES (?, ?, NULL);",
        args: [dTraceId, beforeRaw]
      });
      await tx.execute({
        sql: "DELETE FROM Fact WHERE node_id = ?;",
        args: [srcId]
      });
      deletedIds.push(srcId);
    }

    await tx.commit();

    // Fetch the created fact DTO.
    const rows = await args.db.client.execute({
      sql: `
        SELECT
          f.node_id AS id,
          f.raw AS raw,
          (SELECT MIN(t.timestamp) FROM Traces t WHERE t.node_id = f.node_id) AS created_ts,
          (SELECT MAX(t.timestamp) FROM Traces t WHERE t.node_id = f.node_id) AS updated_ts,
          COALESCE(vector_distance_l2(f.vector_R, vector32(?)), 0) AS strength
        FROM Fact f
        WHERE f.node_id = ?
        LIMIT 1;
      `,
      args: [ZERO_R_JSON, newId]
    });
    const created = rows.rows[0];
    if (!created) throw new Error("merge insert failed");
    return { created: toManagedDto(created), deletedIds };
  } catch (e) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    throw e;
  } finally {
    try {
      await tx.close();
    } catch {
      // ignore
    }
  }
}

export async function deleteFact(args: { db: MemoryDb; id: string }): Promise<boolean> {
  const idNum = Number(String(args.id ?? "").trim());
  if (!Number.isFinite(idNum) || idNum <= 0) return false;

  const tx = await args.db.client.transaction("write");
  const ts = isoNow();
  try {
    const cur = await tx.execute({
      sql: "SELECT raw FROM Fact WHERE node_id = ? LIMIT 1;",
      args: [idNum]
    });
    const row = cur.rows[0];
    if (!row) {
      await tx.rollback();
      return false;
    }

    const beforeRaw = asStr(row.raw);

    const traceRes = await tx.execute({
      sql: "INSERT INTO Traces (timestamp, type, node_id, node_kind) VALUES (?, 'delete', ?, 'fact');",
      args: [ts, idNum]
    });
    const traceId = Number(traceRes.lastInsertRowid ?? 0);

    await tx.execute({
      sql: "INSERT INTO Trace_Changes (trace_id, before_raw, after_raw) VALUES (?, ?, NULL);",
      args: [traceId, beforeRaw]
    });

    await tx.execute({
      sql: "DELETE FROM Fact WHERE node_id = ?;",
      args: [idNum]
    });

    await tx.commit();
    return true;
  } catch {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    return false;
  } finally {
    try {
      await tx.close();
    } catch {
      // ignore
    }
  }
}
