import fs from "node:fs";
import path from "node:path";

export type EcliaConfig = {
  console: { host: string; port: number };
  api: { port: number };
  inference?: any;
};

function isPlainObject(v: any): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return b;
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, any> = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  return b === undefined ? a : b;
}

function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  while (true) {
    const hasToml = fs.existsSync(path.join(dir, "eclia.config.toml"));
    const hasGit = fs.existsSync(path.join(dir, ".git"));
    if (hasToml || hasGit) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function ensureLocalOverrideFile(localPath: string) {
  try {
    if (!fs.existsSync(localPath)) {
      fs.writeFileSync(localPath, "# ECLIA local overrides\n", { encoding: "utf-8", flag: "wx" });
    }
  } catch {
    // ignore
  }
}

/**
 * Minimal TOML reader for dev config needs (host/port).
 * We only parse:
 * - section headers: [a.b.c]
 * - assignments: key = "string" | 'string' | number | true/false
 *
 * Anything else is ignored (arrays, inline tables, etc.).
 * The gateway uses a full TOML parser; this is only for Vite config.
 */
function parseTomlLoose(input: string): any {
  const out: Record<string, any> = {};
  let section: string[] = [];

  const setAtPath = (obj: any, p: string[], k: string, v: any) => {
    let cur = obj;
    for (const seg of p) {
      if (!isPlainObject(cur[seg])) cur[seg] = {};
      cur = cur[seg];
    }
    cur[k] = v;
  };

  const lines = input.split(/\r?\n/);
  for (let raw of lines) {
    // Strip comments (# ...) but keep quoted #.
    raw = raw.trim();
    if (!raw || raw.startsWith("#")) continue;

    // Section header
    const sec = raw.match(/^\[\s*([^\]]+?)\s*\]$/);
    if (sec) {
      section = sec[1].split(".").map((s) => s.trim()).filter(Boolean);
      continue;
    }

    // key = value
    const kv = raw.match(/^([A-Za-z0-9_\-]+)\s*=\s*(.+)$/);
    if (!kv) continue;

    const key = kv[1].trim();
    let valueRaw = kv[2].trim();

    // Drop trailing inline comments if any (naive but practical)
    const hash = valueRaw.indexOf(" #");
    if (hash >= 0) valueRaw = valueRaw.slice(0, hash).trim();

    let value: any = valueRaw;

    // strings
    if (
      (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
      (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
    ) {
      value = valueRaw.slice(1, -1);
    } else if (/^(true|false)$/i.test(valueRaw)) {
      value = valueRaw.toLowerCase() === "true";
    } else if (/^[+-]?[0-9][0-9_]*$/.test(valueRaw)) {
      value = Number(valueRaw.replace(/_/g, ""));
    } else {
      // unsupported value type -> ignore
      continue;
    }

    setAtPath(out, section, key, value);
  }

  return out;
}

function readTomlLoose(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return {};
    const s = fs.readFileSync(filePath, "utf-8");
    return parseTomlLoose(s);
  } catch {
    return {};
  }
}

function toPort(v: any, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i >= 1 && i <= 65535 ? i : fallback;
}

/**
 * Loads config from:
 * - eclia.config.toml (defaults)
 * - eclia.config.local.toml (overrides)
 *
 * This is imported by Vite config (Node context). Keep it robust and dependency-free.
 */
export function loadEcliaConfig(startDir: string) {
  const rootDir = findRepoRoot(startDir);
  const basePath = path.join(rootDir, "eclia.config.toml");
  const localPath = path.join(rootDir, "eclia.config.local.toml");

  ensureLocalOverrideFile(localPath);

  const base = readTomlLoose(basePath);
  const local = readTomlLoose(localPath);
  const merged = deepMerge(base, local);

  const config: EcliaConfig = {
    console: {
      host: String(merged?.console?.host ?? "127.0.0.1"),
      port: toPort(merged?.console?.port, 5173)
    },
    api: {
      port: toPort(merged?.api?.port, 8787)
    },
    inference: merged?.inference
  };

  return { rootDir, basePath, localPath, config };
}
