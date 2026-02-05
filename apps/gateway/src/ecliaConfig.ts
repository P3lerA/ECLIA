import fs from "node:fs";
import path from "node:path";
import * as TOML from "@iarna/toml";

export type InferenceProviderId = "openai_compat";

export type OpenAICompatConfig = {
  /**
   * Base URL of an OpenAI-compatible server.
   * Examples:
   * - https://api.openai.com/v1
   * - http://localhost:30000/v1 (local SGLang, etc.)
   */
  base_url: string;
  /** API key (recommended to store in eclia.config.local.toml or env vars). */
  api_key?: string;
  /** Default model name. Can be overridden per request. */
  model: string;
};

export type EcliaConfig = {
  console: {
    host: string;
    port: number;
  };
  api: {
    /** Gateway port (dev). */
    port: number;
  };
  inference: {
    provider: InferenceProviderId;
    openai_compat: OpenAICompatConfig;
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
  },
  inference: {
    provider: "openai_compat",
    openai_compat: {
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini"
    }
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

function coerceNonEmptyString(v: unknown, fallback: string): string {
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
  base.console.host = coerceNonEmptyString(consoleObj.host, base.console.host);
  base.console.port = clampPort(consoleObj.port, base.console.port);

  const apiObj = isRecord(obj.api) ? obj.api : {};
  base.api.port = clampPort(apiObj.port, base.api.port);

  const inferenceObj = isRecord(obj.inference) ? obj.inference : {};
  const provider = coerceNonEmptyString(inferenceObj.provider, base.inference.provider) as InferenceProviderId;
  base.inference.provider = provider;

  const openaiObj =
    isRecord(inferenceObj.openai_compat) ? (inferenceObj.openai_compat as Record<string, unknown>) : {};
  base.inference.openai_compat.base_url = coerceNonEmptyString(openaiObj.base_url, base.inference.openai_compat.base_url);
  base.inference.openai_compat.model = coerceNonEmptyString(openaiObj.model, base.inference.openai_compat.model);

  const apiKey = typeof openaiObj.api_key === "string" ? openaiObj.api_key.trim() : "";
  if (apiKey) base.inference.openai_compat.api_key = apiKey;

  return base;
}

function applyEnvOverrides(cfg: EcliaConfig): EcliaConfig {
  const out: EcliaConfig = JSON.parse(JSON.stringify(cfg));

  out.console.host = coerceNonEmptyString(process.env.ECLIA_CONSOLE_HOST, out.console.host);
  out.console.port = clampPort(process.env.ECLIA_CONSOLE_PORT, out.console.port);
  out.api.port = clampPort(process.env.ECLIA_API_PORT, out.api.port);

  // Inference (OpenAI-compatible)
  const baseUrl = process.env.ECLIA_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL;
  if (baseUrl) out.inference.openai_compat.base_url = coerceNonEmptyString(baseUrl, out.inference.openai_compat.base_url);

  const model = process.env.ECLIA_OPENAI_MODEL ?? process.env.OPENAI_MODEL;
  if (model) out.inference.openai_compat.model = coerceNonEmptyString(model, out.inference.openai_compat.model);

  const apiKey = process.env.ECLIA_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (apiKey) out.inference.openai_compat.api_key = apiKey;

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
  try {
    if (fs.existsSync(basePath) && !fs.existsSync(localPath)) {
      fs.writeFileSync(localPath, "# ECLIA local overrides (gitignored)\n", { encoding: "utf-8", flag: "wx" });
    }
  } catch {
    // ignore (read-only envs / race)
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

  // Sanitize only the keys we actively write (do NOT drop other sections like inference keys).
  if (!isRecord(nextLocal.console)) nextLocal.console = {};
  const c = nextLocal.console as Record<string, unknown>;
  c.host = coerceNonEmptyString(c.host, DEFAULT_ECLIA_CONFIG.console.host);
  c.port = clampPort(c.port, DEFAULT_ECLIA_CONFIG.console.port);

  if (!isRecord(nextLocal.api)) nextLocal.api = {};
  const a = nextLocal.api as Record<string, unknown>;
  a.port = clampPort(a.port, DEFAULT_ECLIA_CONFIG.api.port);

  fs.writeFileSync(localPath, TOML.stringify(nextLocal), "utf-8");

  const { config } = loadEcliaConfig(rootDir);
  return { rootDir, config };
}
