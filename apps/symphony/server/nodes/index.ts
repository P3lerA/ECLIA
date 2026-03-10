import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Registry } from "../registry.js";
import type { NodeFactory } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Scan this directory for node factory modules and register them all. */
export async function registerBuiltins(registry: Registry): Promise<void> {
  const files = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .filter((f) => f !== "index.ts" && f !== "index.js");

  for (const file of files) {
    const mod = await import(`./${file.replace(/\.ts$/, ".js")}`);
    const fac: NodeFactory | undefined = mod.factory;
    if (!fac || typeof fac.kind !== "string") {
      console.warn(`[symphony] nodes/${file}: no valid "factory" export, skipping`);
      continue;
    }
    registry.register(fac);
  }
}
