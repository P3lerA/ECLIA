import fs from "node:fs";
import path from "node:path";

type AnyObj = Record<string, any>;

function isObject(v: unknown): v is AnyObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: AnyObj, override: AnyObj): AnyObj {
  const out: AnyObj = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

export function resolveRepoRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (let i = 0; i < 30; i++) {
    const hasConfig = fs.existsSync(path.join(dir, "eclia.config.toml"));
    const hasWorkspace = fs.existsSync(path.join(dir, "pnpm-workspace.yaml"));
    if (hasConfig || hasWorkspace) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

// Minimal TOML parser (enough for our config files).
// Supports: [section], nested via dots, and key = value where value is string/number/bool.
function parseTomlLoose(text: string): AnyObj {
  const out: AnyObj = {};
  let ctx: AnyObj = out;

  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[") && line.endsWith("]")) {
      const section = line.slice(1, -1).trim();
      const parts = section.split(".").map((s) => s.trim()).filter(Boolean);
      ctx = out;
      for (const p of parts) {
        if (!isObject(ctx[p])) ctx[p] = {};
        ctx = ctx[p];
      }
      continue;
    }

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();

    if (!(val.startsWith('"') || val.startsWith("'"))) {
      const hash = val.indexOf("#");
      if (hash !== -1) val = val.slice(0, hash).trim();
    }

    let parsed: any = val;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      parsed = val.slice(1, -1);
    } else if (/^(true|false)$/i.test(val)) {
      parsed = val.toLowerCase() === "true";
    } else if (/^-?\d[\d_]*(\.\d[\d_]*)?$/.test(val)) {
      parsed = Number(val.replace(/_/g, ""));
    } else {
      parsed = val;
    }

    ctx[key] = parsed;
  }

  return out;
}

export function ensureLocalConfig(repoRoot: string): void {
  const localPath = path.join(repoRoot, "eclia.config.local.toml");
  if (fs.existsSync(localPath)) return;

  try {
    fs.writeFileSync(localPath, "# ECLIA local overrides (not committed)\n", { encoding: "utf-8", flag: "wx" });
  } catch {
    // best-effort: ignore permission/race errors
  }
}

export function loadEcliaConfig(repoRoot: string): AnyObj {
  const basePath = path.join(repoRoot, "eclia.config.toml");
  const localPath = path.join(repoRoot, "eclia.config.local.toml");

  const base = fs.existsSync(basePath) ? parseTomlLoose(fs.readFileSync(basePath, "utf-8")) : {};
  const local = fs.existsSync(localPath) ? parseTomlLoose(fs.readFileSync(localPath, "utf-8")) : {};

  return deepMerge(base, local);
}
