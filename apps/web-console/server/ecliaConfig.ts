import fs from "node:fs";
import path from "node:path";
import * as TOML from "@iarna/toml";

export type EcliaConfig = {
  console: {
    host: string;
    port: number;
  };
  api: {
    port: number;
  };
};

export type EcliaConfigPatch = Partial<{
  console: Partial<EcliaConfig["console"]>;
  api: Partial<EcliaConfig["api"]>;
}>;

export const DEFAULT_ECLIA_CONFIG: EcliaConfig = {
  console: {
    host: "127.0.0.1",
    port: 5173
  },
  api: {
    port: 8787
  }
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampPort(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 1 || i > 65535) return fallback;
  return i;
}

function coerceHost(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s.length ? s : fallback;
}

function deepMerge<T extends Record<string, any>>(a: T, b: Partial<T>): T {
  const out: any = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (isRecord(v) && isRecord(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, "eclia.config.toml"))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

function tryReadToml(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = TOML.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function coerceConfig(obj: Record<string, unknown>): EcliaConfig {
  const base: EcliaConfig = JSON.parse(JSON.stringify(DEFAULT_ECLIA_CONFIG));

  const consoleObj = isRecord(obj.console) ? obj.console : {};
  base.console.host = coerceHost(consoleObj.host, base.console.host);
  base.console.port = clampPort(consoleObj.port, base.console.port);

  const apiObj = isRecord(obj.api) ? obj.api : {};
  base.api.port = clampPort(apiObj.port, base.api.port);

  return base;
}

function applyEnvOverrides(cfg: EcliaConfig): EcliaConfig {
  const out: EcliaConfig = JSON.parse(JSON.stringify(cfg));

  out.console.host = coerceHost(process.env.ECLIA_CONSOLE_HOST, out.console.host);
  out.console.port = clampPort(process.env.ECLIA_CONSOLE_PORT, out.console.port);
  out.api.port = clampPort(process.env.ECLIA_API_PORT, out.api.port);

  return out;
}

export function loadEcliaConfig(startDir: string = process.cwd()): {
  rootDir: string;
  config: EcliaConfig;
  paths: { base: string; local: string };
} {
  const rootDir = findProjectRoot(startDir);
  const basePath = path.join(rootDir, "eclia.config.toml");
  const localPath = path.join(rootDir, "eclia.config.local.toml");

  // Ensure the local override file exists (gitignored).
  // This keeps the mental model simple: base config is committed, local is always present.
  try {
    if (fs.existsSync(basePath) && !fs.existsSync(localPath)) {
      fs.writeFileSync(localPath, "# ECLIA local overrides (gitignored)\n", "utf-8");
    }
  } catch {
    // ignore (read-only envs)
  }

  const baseObj = tryReadToml(basePath);
  const localObj = tryReadToml(localPath);

  const mergedObj = deepMerge(baseObj, localObj);
  const fileCfg = coerceConfig(mergedObj);
  const config = applyEnvOverrides(fileCfg);

  return { rootDir, config, paths: { base: basePath, local: localPath } };
}

export function writeLocalEcliaConfig(
  patch: EcliaConfigPatch,
  startDir: string = process.cwd()
): { rootDir: string; config: EcliaConfig } {
  const rootDir = findProjectRoot(startDir);
  const localPath = path.join(rootDir, "eclia.config.local.toml");

  const currentLocal = tryReadToml(localPath);
  const nextLocal = deepMerge(currentLocal, patch as Record<string, unknown>);

  // Keep the file small + normalized (only store known keys).
  const normalized = coerceConfig(nextLocal);

  const toWrite: Record<string, any> = {
    console: { host: normalized.console.host, port: normalized.console.port },
    api: { port: normalized.api.port }
  };

  fs.writeFileSync(localPath, TOML.stringify(toWrite), "utf-8");

  const { config } = loadEcliaConfig(rootDir);
  return { rootDir, config };
}
