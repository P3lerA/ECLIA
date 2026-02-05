import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import * as TOML from "@iarna/toml";

/**
 * Canonical config schema (dev-time).
 * - eclia.config.toml: committed defaults (no secrets)
 * - eclia.config.local.toml: machine-specific overrides (gitignored, may contain secrets)
 *
 * IMPORTANT:
 * - UI "preferences" should not be stored in TOML (use localStorage). TOML is for process startup config.
 */
export type EcliaConfig = {
  console: {
    host: string;
    port: number;
  };
  api: {
    port: number;
  };
  inference: {
    provider: "openai_compat";
    openai_compat: {
      base_url: string; // e.g. https://api.openai.com/v1
      model: string; // real upstream model id
      api_key?: string; // secret (prefer local overrides)
      auth_header?: string; // default: Authorization
    };
  };
};

export type EcliaConfigPatch = Partial<{
  console: Partial<EcliaConfig["console"]>;
  api: Partial<EcliaConfig["api"]>;
  inference: Partial<{
    provider: EcliaConfig["inference"]["provider"];
    openai_compat: Partial<EcliaConfig["inference"]["openai_compat"]>;
  }>;
}>;

export const DEFAULT_ECLIA_CONFIG: EcliaConfig = {
  console: { host: "127.0.0.1", port: 5173 },
  api: { port: 8787 },
  inference: {
    provider: "openai_compat",
    openai_compat: {
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      auth_header: "Authorization"
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

function coerceHost(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s.length ? s : fallback;
}

function coerceString(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s.length ? s : fallback;
}

function deepMerge(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (isRecord(v) && isRecord(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function coerceConfig(raw: Record<string, any>): EcliaConfig {
  const base = DEFAULT_ECLIA_CONFIG;

  const consoleRaw = isRecord(raw.console) ? raw.console : {};
  const apiRaw = isRecord(raw.api) ? raw.api : {};
  const infRaw = isRecord(raw.inference) ? raw.inference : {};

  const openaiRaw = isRecord((infRaw as any).openai_compat) ? (infRaw as any).openai_compat : {};

  const provider = (infRaw as any).provider === "openai_compat" ? "openai_compat" : base.inference.provider;

  return {
    console: {
      host: coerceHost(consoleRaw.host, base.console.host),
      port: clampPort(consoleRaw.port, base.console.port)
    },
    api: {
      port: clampPort(apiRaw.port, base.api.port)
    },
    inference: {
      provider,
      openai_compat: {
        base_url: coerceString(openaiRaw.base_url, base.inference.openai_compat.base_url),
        model: coerceString(openaiRaw.model, base.inference.openai_compat.model),
        api_key: typeof openaiRaw.api_key === "string" ? openaiRaw.api_key : undefined,
        auth_header: coerceString(openaiRaw.auth_header, base.inference.openai_compat.auth_header ?? "Authorization")
      }
    }
  };
}

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

function tryReadToml(filePath: string): Record<string, any> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const txt = fs.readFileSync(filePath, "utf-8");
    const parsed = TOML.parse(txt);
    return isRecord(parsed) ? (parsed as any) : {};
  } catch {
    return {};
  }
}

/**
 * Ensure eclia.config.local.toml exists.
 * This is intentionally best-effort: failures should not crash dev startup.
 */
export function ensureLocalConfig(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  localPath: string;
  created: boolean;
} {
  const localPath = path.join(rootDir, "eclia.config.local.toml");
  if (fs.existsSync(localPath)) return { rootDir, localPath, created: false };

  try {
    // "wx" = write only if not exists (prevents clobbering)
    fs.writeFileSync(localPath, "# ECLIA local overrides (gitignored)\n", { encoding: "utf-8", flag: "wx" });
    return { rootDir, localPath, created: true };
  } catch {
    return { rootDir, localPath, created: false };
  }
}

export function loadEcliaConfig(startDir: string = process.cwd()): {
  rootDir: string;
  configPath: string;
  localPath: string;
  config: EcliaConfig;
  raw: Record<string, any>;
} {
  const rootDir = findProjectRoot(startDir);
  const configPath = path.join(rootDir, "eclia.config.toml");
  const localPath = path.join(rootDir, "eclia.config.local.toml");

  // best-effort create local overrides file
  ensureLocalConfig(rootDir);

  const base = tryReadToml(configPath);
  const local = tryReadToml(localPath);

  const merged = deepMerge(base, local);
  const config = coerceConfig(merged);

  return { rootDir, configPath, localPath, config, raw: merged };
}

/**
 * Write a patch into eclia.config.local.toml.
 *
 * Safety rule:
 * - preserve unknown keys/sections (do not wipe inference keys just to update host/port).
 * - normalize known keys for type safety.
 */
export function writeLocalEcliaConfig(
  patch: EcliaConfigPatch,
  startDir: string = process.cwd()
): { rootDir: string; localPath: string; config: EcliaConfig } {
  const rootDir = findProjectRoot(startDir);
  const localPath = path.join(rootDir, "eclia.config.local.toml");

  ensureLocalConfig(rootDir);

  const currentLocal = tryReadToml(localPath);
  const nextLocal = deepMerge(currentLocal, patch as any);

  // Normalize known keys, but keep everything else.
  const normalized = coerceConfig(nextLocal);

  // Rebuild known sections on top of the merged object so types are stable.
  const toWrite: Record<string, any> = {
    ...nextLocal,
    console: { host: normalized.console.host, port: normalized.console.port },
    api: { port: normalized.api.port },
    inference: {
      ...(isRecord(nextLocal.inference) ? nextLocal.inference : {}),
      provider: normalized.inference.provider,
      openai_compat: {
        ...(isRecord(nextLocal.inference?.openai_compat) ? (nextLocal.inference as any).openai_compat : {}),
        base_url: normalized.inference.openai_compat.base_url,
        model: normalized.inference.openai_compat.model,
        auth_header: normalized.inference.openai_compat.auth_header
      }
    }
  };

  // api_key: only write if present in patch OR already present in file
  const hasKey = typeof (nextLocal as any)?.inference?.openai_compat?.api_key === "string";
  if (hasKey) {
    (toWrite as any).inference.openai_compat.api_key = (nextLocal as any).inference.openai_compat.api_key;
  }

  fs.writeFileSync(localPath, TOML.stringify(toWrite), "utf-8");

  const { config } = loadEcliaConfig(rootDir);
  return { rootDir, localPath, config };
}

/**
 * Preflight port bind to detect common Windows issues:
 * - EACCES: reserved/excluded port (admin does not always help)
 * - EADDRINUSE: already used
 */
export async function preflightListen(host: string, port: number): Promise<{ ok: true } | { ok: false; error: string; hint?: string }> {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    const onError = (err: any) => {
      const code = String(err?.code ?? "ERR");
      if (code === "EACCES") {
        resolve({
          ok: false,
          error: "permission_denied",
          hint: `Cannot bind ${host}:${port} (EACCES). On Windows this often means the port is reserved/excluded. Try a higher port (e.g. 5173, 3000, 8080).`
        });
      } else if (code === "EADDRINUSE") {
        resolve({
          ok: false,
          error: "port_in_use",
          hint: `Port ${port} is already in use. Choose another port.`
        });
      } else if (code === "EADDRNOTAVAIL") {
        resolve({
          ok: false,
          error: "host_unavailable",
          hint: `Host ${host} is not available on this machine.`
        });
      } else {
        resolve({
          ok: false,
          error: code,
          hint: `Cannot bind ${host}:${port} (${code}).`
        });
      }
    };

    srv.once("error", onError);
    srv.listen({ host, port }, () => {
      srv.close(() => resolve({ ok: true }));
    });
  });
}

/**
 * Utility: join base_url with a path (avoid double slashes).
 */
export function joinUrl(baseUrl: string, pathSuffix: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  const p = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
  return `${b}${p}`;
}

/**
 * Resolve the actual upstream model id from a UI route key.
 * The UI uses friendly "route" strings; upstream wants real model ids.
 */
export function resolveUpstreamModel(routeKey: string, config: EcliaConfig): string {
  const k = (routeKey ?? "").trim();
  // Known route keys from the UI:
  if (k === "openai-compatible" || k === "router/gateway" || k === "local/ollama") {
    return config.inference.openai_compat.model;
  }
  // If the UI sends a real model id, pass through.
  return k.length ? k : config.inference.openai_compat.model;
}
