import fsp from "node:fs/promises";
import path from "node:path";

import type { StateAccessor } from "./types.js";
import { ensureDir, writeJsonAtomic, removeFile } from "./json-file.js";

/**
 * File-backed key-value state store.
 *
 * Runtime state (e.g. IMAP lastUid) lives under:
 *   <rootDir>/.eclia/symphony/state/<flowId>.json
 *
 * All mutations are atomic (write-tmp + rename).
 */
export class StateStore {
  private dir: string;
  private cache = new Map<string, Record<string, unknown>>();

  constructor(rootDir: string) {
    this.dir = path.join(rootDir, ".eclia", "symphony", "state");
  }

  async init(): Promise<void> {
    await ensureDir(this.dir);
  }

  scope(flowId: string): StateAccessor {
    const safeId = sanitiseId(flowId);
    return {
      get: <V>(key: string) => this.get<V>(safeId, key),
      set: <V>(key: string, value: V) => this.set(safeId, key, value)
    };
  }

  async clear(flowId: string): Promise<void> {
    const safeId = sanitiseId(flowId);
    this.cache.delete(safeId);
    await removeFile(this.filePath(safeId));
  }

  // ── Internal ───────────────────────────────────────────────

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private async load(id: string): Promise<Record<string, unknown>> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    try {
      const raw = await fsp.readFile(this.filePath(id), "utf-8");
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        this.cache.set(id, obj);
        return obj;
      }
    } catch { /* missing or corrupt */ }
    const fresh: Record<string, unknown> = {};
    this.cache.set(id, fresh);
    return fresh;
  }

  private async get<V>(id: string, key: string): Promise<V | undefined> {
    const data = await this.load(id);
    return data[key] as V | undefined;
  }

  private async set(id: string, key: string, value: unknown): Promise<void> {
    const data = await this.load(id);
    data[key] = value;
    this.cache.set(id, data);
    await writeJsonAtomic(this.filePath(id), data);
  }
}

export function sanitiseId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80) || "default";
}
