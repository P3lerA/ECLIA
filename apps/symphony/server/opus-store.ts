import fsp from "node:fs/promises";
import path from "node:path";
import type { OpusDef } from "./types.js";
import { sanitiseId } from "./state-store.js";
import { ensureDir, writeJsonAtomic, removeFile } from "./json-file.js";

/**
 * Persists opus definitions as individual JSON files.
 *
 * Location: <rootDir>/.eclia/symphony/opus/<opusId>.json
 *
 * Why JSON and not TOML:
 *   Graph structures (nodes[], links[]) are deeply nested arrays of objects.
 *   TOML's [[array.of.tables]] syntax makes this painful to read and edit.
 *   JSON is the natural serialisation for graph data.
 */
export class OpusStore {
  private dir: string;

  constructor(rootDir: string) {
    this.dir = path.join(rootDir, ".eclia", "symphony", "opus");
  }

  async init(): Promise<void> {
    await ensureDir(this.dir);
  }

  /** Load all saved opus definitions. */
  async loadAll(): Promise<OpusDef[]> {
    const defs: OpusDef[] = [];
    let entries: string[];
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return defs;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fsp.readFile(path.join(this.dir, entry), "utf-8");
        const obj = JSON.parse(raw);
        if (isOpusDef(obj)) defs.push(obj);
      } catch { /* skip corrupt */ }
    }
    return defs;
  }

  async save(def: OpusDef): Promise<void> {
    await writeJsonAtomic(this.filePath(def.id), def);
  }

  async remove(opusId: string): Promise<void> {
    await removeFile(this.filePath(opusId));
  }

  private filePath(opusId: string): string {
    return path.join(this.dir, `${sanitiseId(opusId)}.json`);
  }
}

function isOpusDef(obj: unknown): obj is OpusDef {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as any;
  return typeof o.id === "string" && Array.isArray(o.nodes) && Array.isArray(o.links);
}
