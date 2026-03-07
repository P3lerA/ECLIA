import fsp from "node:fs/promises";
import path from "node:path";

import type { StateAccessor } from "./types.js";

/**
 * File-backed key-value state store.
 *
 * Each instrument gets its own JSON file under:
 *   <rootDir>/.eclia/symphony/<instrumentId>.json
 *
 * All mutations are atomic (write-tmp + rename).
 */
export class StateStore {
  private dir: string;
  /** In-memory cache per instrument; flushed on every write. */
  private cache = new Map<string, Record<string, unknown>>();

  constructor(rootDir: string) {
    this.dir = path.join(rootDir, ".eclia", "symphony");
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
  }

  /** Return a scoped accessor for one instrument. */
  scope(instrumentId: string): StateAccessor {
    const safeId = sanitiseId(instrumentId);
    return {
      get: <V>(key: string) => this.get<V>(safeId, key),
      set: <V>(key: string, value: V) => this.set(safeId, key, value)
    };
  }

  /** Delete all state for an instrument. */
  async clear(instrumentId: string): Promise<void> {
    const safeId = sanitiseId(instrumentId);
    this.cache.delete(safeId);
    try {
      await fsp.unlink(this.filePath(safeId));
    } catch {
      /* ignore missing */
    }
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
    } catch {
      /* missing or corrupt — start fresh */
    }

    const fresh: Record<string, unknown> = {};
    this.cache.set(id, fresh);
    return fresh;
  }

  private async flush(id: string, data: Record<string, unknown>): Promise<void> {
    const fp = this.filePath(id);
    const tmp = `${fp}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fsp.rename(tmp, fp);
  }

  private async get<V>(id: string, key: string): Promise<V | undefined> {
    const data = await this.load(id);
    return data[key] as V | undefined;
  }

  private async set(id: string, key: string, value: unknown): Promise<void> {
    const data = await this.load(id);
    data[key] = value;
    this.cache.set(id, data);
    await this.flush(id, data);
  }
}

function sanitiseId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80) || "default";
}
