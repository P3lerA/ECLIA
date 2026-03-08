import fsp from "node:fs/promises";
import path from "node:path";
import type { FlowDef } from "./types.js";
import { sanitiseId } from "./state-store.js";
import { ensureDir, writeJsonAtomic, removeFile } from "./json-file.js";

/**
 * Persists flow definitions as individual JSON files.
 *
 * Location: <rootDir>/.eclia/symphony/flows/<flowId>.json
 *
 * Why JSON and not TOML:
 *   Graph structures (nodes[], links[]) are deeply nested arrays of objects.
 *   TOML's [[array.of.tables]] syntax makes this painful to read and edit.
 *   JSON is the natural serialisation for graph data.
 */
export class FlowStore {
  private dir: string;

  constructor(rootDir: string) {
    this.dir = path.join(rootDir, ".eclia", "symphony", "flows");
  }

  async init(): Promise<void> {
    await ensureDir(this.dir);
  }

  /** Load all saved flows. */
  async loadAll(): Promise<FlowDef[]> {
    const flows: FlowDef[] = [];
    let entries: string[];
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return flows;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fsp.readFile(path.join(this.dir, entry), "utf-8");
        const obj = JSON.parse(raw);
        if (isFlowDef(obj)) flows.push(obj);
      } catch { /* skip corrupt */ }
    }
    return flows;
  }

  async save(flow: FlowDef): Promise<void> {
    await writeJsonAtomic(this.filePath(flow.id), flow);
  }

  async remove(flowId: string): Promise<void> {
    await removeFile(this.filePath(flowId));
  }

  private filePath(flowId: string): string {
    return path.join(this.dir, `${sanitiseId(flowId)}.json`);
  }
}

function isFlowDef(obj: unknown): obj is FlowDef {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as any;
  return typeof o.id === "string" && Array.isArray(o.nodes) && Array.isArray(o.links);
}
