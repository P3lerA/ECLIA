// Robust cross-platform dist/ cleaner.
// Uses rename (atomic, immune to file locks) instead of rmSync directly.
// The previous dist is parked as dist._old and cleaned up on the next run.

import { renameSync, rmSync, existsSync } from "node:fs";

const dist = "dist";
const old = "dist._old";

// Clean up leftovers from a previous build first
if (existsSync(old)) rmSync(old, { recursive: true, force: true });

// Park current dist out of the way
if (existsSync(dist)) renameSync(dist, old);
