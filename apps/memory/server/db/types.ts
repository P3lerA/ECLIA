import type { Client } from "@libsql/client";

export type MemoryDb = {
  client: Client;
  /** Absolute path on disk (for local file databases). */
  dbPath: string;
  /** The currently configured embeddings model. */
  embeddingsModel: string;
};

export type ManagedMemoryDto = {
  id: string;
  raw: string;
  createdAt: number;
  updatedAt: number;
  /** Norm of r (computed). */
  strength: number;
  /** Number of times this fact was activated (recalled). */
  activationCount: number;
  /** Epoch ms of most recent activation. 0 if never activated. */
  lastActivatedAt: number;
  /** source_session from the earliest activation. "" if never activated. */
  originSession: string;
};

export type RecallMemoryDto = {
  id: string;
  raw: string;
  /** Higher is better. Null if unavailable. */
  score: number | null;
};
