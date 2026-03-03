import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import type { MemoryDb } from "./types.js";

function safeModelSlug(model: string): string {
  const clean = String(model ?? "").trim() || "default";
  const slug = clean
    .replace(/\//g, "--")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  const hash = createHash("sha1").update(clean).digest("hex").slice(0, 10);
  return slug ? `${slug}_${hash}` : `model_${hash}`;
}

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
}

export async function openMemoryDb(args: { rootDir: string; embeddingsModel: string }): Promise<MemoryDb> {
  const rootDir = path.resolve(args.rootDir);
  const embeddingsModel = String(args.embeddingsModel ?? "").trim() || "default";

  const dir = path.join(rootDir, ".eclia", "memory");
  fs.mkdirSync(dir, { recursive: true });

  const dbFile = `${safeModelSlug(embeddingsModel)}.db`;
  const dbPath = path.join(dir, dbFile);

  const client = createClient({
    url: toLibsqlFileUrl(dbPath),
    // match upstream default (20) unless configured elsewhere
    concurrency: 20
  });

  await migrate(client);

  return { client, dbPath, embeddingsModel };
}
