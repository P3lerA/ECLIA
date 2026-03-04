import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import type { MemoryDb } from "./types.js";

function toLibsqlFileUrl(absPath: string): string {
  // Turso docs show "file:path/to/db-file.db" (no file://). We normalize to
  // forward slashes so Windows paths become file:C:/... which libsql accepts.
  const p = absPath.replace(/\\/g, "/");
  return `file:${p}`;
}

async function migrate(client: Client) {
  // Best-effort pragmas.
  await client.execute("PRAGMA foreign_keys = ON;");
  await client.execute("PRAGMA journal_mode = WAL;");
  await client.execute("PRAGMA synchronous = NORMAL;");

  // NOTE: The schema below follows the design doc table names/columns, but
  // adds minimal foreign keys for usability (trace_id / activation_id).
  await client.execute(`
    CREATE TABLE IF NOT EXISTS Traces (
      id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      node_id INTEGER,
      node_kind TEXT
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS Trace_Changes (
      id INTEGER PRIMARY KEY,
      trace_id INTEGER NOT NULL,
      before_raw TEXT,
      after_raw TEXT,
      FOREIGN KEY(trace_id) REFERENCES Traces(id) ON DELETE CASCADE
    );
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS Traces_node_id_idx ON Traces(node_id);
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS Activation (
      id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS Activation_Nodes (
      id INTEGER PRIMARY KEY,
      activation_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      strength REAL NOT NULL,
      source_session TEXT NOT NULL,
      FOREIGN KEY(activation_id) REFERENCES Activation(id) ON DELETE CASCADE
    );
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS Activation_Nodes_activation_id_idx ON Activation_Nodes(activation_id);
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS Fact (
      node_id INTEGER PRIMARY KEY,
      raw TEXT NOT NULL,
      vector_S BLOB,
      vector_R BLOB
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS Corpus (
      node_id INTEGER PRIMARY KEY,
      token TEXT NOT NULL,
      vector_T BLOB,
      vector_R BLOB
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS Meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export async function getMeta(client: Client, key: string): Promise<string | null> {
  const res = await client.execute({ sql: "SELECT value FROM Meta WHERE key = ? LIMIT 1;", args: [key] });
  const row = res.rows[0];
  if (!row) return null;
  return typeof row.value === "string" ? row.value : String(row.value ?? "");
}

export async function setMeta(client: Client, key: string, value: string): Promise<void> {
  await client.execute({
    sql: "INSERT INTO Meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
    args: [key, value]
  });
}

export async function openMemoryDb(args: { rootDir: string; embeddingsModel: string }): Promise<MemoryDb> {
  const rootDir = path.resolve(args.rootDir);
  const embeddingsModel = String(args.embeddingsModel ?? "").trim() || "default";

  const dir = path.join(rootDir, ".eclia", "memory");
  fs.mkdirSync(dir, { recursive: true });

  const dbPath = path.join(dir, "memory.db");

  // Legacy migration: rename old model-slug DB to memory.db if it's the only one.
  if (!fs.existsSync(dbPath)) {
    const existing = fs.readdirSync(dir).filter(
      (f) => f.endsWith(".db") && !f.endsWith("-wal") && !f.endsWith("-shm")
    );
    if (existing.length === 1) {
      const legacyPath = path.join(dir, existing[0]);
      console.log(`[memory] migrating legacy DB: ${existing[0]} -> memory.db`);
      fs.renameSync(legacyPath, dbPath);
      const legacyWal = legacyPath + "-wal";
      const legacyShm = legacyPath + "-shm";
      if (fs.existsSync(legacyWal)) fs.renameSync(legacyWal, dbPath + "-wal");
      if (fs.existsSync(legacyShm)) fs.renameSync(legacyShm, dbPath + "-shm");
    } else if (existing.length > 1) {
      console.warn(`[memory] multiple legacy DB files found in ${dir}; using fresh memory.db`);
    }
  }

  const client = createClient({
    url: toLibsqlFileUrl(dbPath),
    concurrency: 20
  });

  await migrate(client);

  return { client, dbPath, embeddingsModel };
}
