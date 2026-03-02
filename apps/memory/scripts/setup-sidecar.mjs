#!/usr/bin/env node
/**
 * Sets up the Python venv for the embeddings sidecar.
 * Called automatically by `postinstall` in apps/memory/package.json.
 *
 * - Creates apps/memory/sidecar/.venv if it doesn't exist
 * - Installs / upgrades requirements.txt into the venv
 * - Never throws: errors are printed as warnings so pnpm install continues
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(__dirname, "..", "sidecar");
const venvDir = path.join(sidecarDir, ".venv");
const reqFile = path.join(sidecarDir, "requirements.txt");

const isWin = process.platform === "win32";
const venvPython = isWin
  ? path.join(venvDir, "Scripts", "python.exe")
  : path.join(venvDir, "bin", "python3");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  return result.status === 0;
}

function findPython() {
  for (const candidate of ["python3", "python"]) {
    const result = spawnSync(candidate, ["--version"], { stdio: "pipe" });
    if (result.status === 0) return candidate;
  }
  return null;
}

console.log("[memory/sidecar] Setting up Python embeddings sidecar…");

const python = findPython();
if (!python) {
  console.warn("[memory/sidecar] ⚠  Python not found — skipping sidecar setup.");
  console.warn("                    Install Python 3.9+ to enable local embeddings.");
  process.exit(0);
}

// Create venv if missing.
if (!fs.existsSync(venvPython)) {
  console.log(`[memory/sidecar] Creating venv at ${venvDir}`);
  if (!run(python, ["-m", "venv", venvDir])) {
    console.warn("[memory/sidecar] ⚠  Failed to create venv — skipping.");
    process.exit(0);
  }
}

// Install / upgrade requirements.
console.log("[memory/sidecar] Installing Python dependencies…");
const pip = isWin
  ? path.join(venvDir, "Scripts", "pip.exe")
  : path.join(venvDir, "bin", "pip");

if (!run(pip, ["install", "-q", "--upgrade", "-r", reqFile])) {
  console.warn("[memory/sidecar] ⚠  pip install failed — check the output above.");
  process.exit(0);
}

console.log("[memory/sidecar] ✓ Python sidecar ready.");
