// Robust cross-platform dist/ cleaner.
// Uses rename (atomic, immune to file locks) instead of rmSync directly.
// Old dirs are parked as dist._old_<ts> and cleaned up best-effort on next run.

import { renameSync, rmSync, existsSync, readdirSync } from "node:fs";

// Best-effort cleanup of any previous dist._old_* leftovers
try {
  for (const f of readdirSync(".")) {
    if (f.startsWith("dist._old_")) {
      try { rmSync(f, { recursive: true, force: true }); } catch {}
    }
  }
} catch {}

// Park current dist out of the way (try-catch to handle TOCTOU race with parallel launches)
try {
  if (existsSync("dist")) renameSync("dist", `dist._old_${Date.now()}`);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
