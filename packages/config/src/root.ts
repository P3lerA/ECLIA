import fs from "node:fs";
import path from "node:path";

/**
 * Find repository/project root from any working directory.
 * We treat the directory containing eclia.config.toml (or a .git folder) as root.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let cur = path.resolve(startDir);

  for (let i = 0; i < 30; i++) {
    const cfg = path.join(cur, "eclia.config.toml");
    const git = path.join(cur, ".git");
    const ws = path.join(cur, "pnpm-workspace.yaml");

    if (fs.existsSync(cfg) || fs.existsSync(ws) || fs.existsSync(git)) return cur;

    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return path.resolve(startDir);
}
