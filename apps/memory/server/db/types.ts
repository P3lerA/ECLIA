import type { Client } from "@libsql/client";

export type MemoryDb = {
  client: Client;
  /** Absolute path on disk (for local file databases). */
  dbPath: string;
  /** Effective embeddings model name used to namespace this database file. */
  embeddingsModel: string;
};

export type ManagedMemoryDto = {
  id: string;
  raw: string;
  createdAt: number;
  updatedAt: number;
  /** Norm of r (computed). */
  strength: number;
};

export type RecallMemoryDto = {
  id: string;
  raw: string;
  /** Higher is better. Null if unavailable. */
  score: number | null;
};
