/// <reference path="./iarna__toml.d.ts" />

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
  /**
   * Optional override for Codex CLI local state directory.
   * If set, gateway will treat this as ECLIA_CODEX_HOME / CODEX_HOME for spawned `codex app-server`.
   */
  codex_home?: string;

  console: {
    host: string;
    port: number;
  };
  api: {
    port: number;
  };

  /**
   * Debug/dev features.
   *
   * These options are intended for local development and troubleshooting.
   */
  debug: {
    /**
     * When enabled, the gateway will dump the *full* upstream request body for each
     * model request under:
     *   <repo>/.eclia/debug/<sessionId>/
     */
    capture_upstream_requests: boolean;
  };

  /**
   * Optional "skills" system.
   *
   * Skills are user-enabled capability packs stored under:
   *   <repo>/skills/<name>/skill.md
   *
   * NOTE: The config only tracks which skills are enabled.
   * Skill discovery/metadata is handled by the gateway at runtime.
   */
  skills: {
    /**
     * Names of enabled skills.
     *
     * IMPORTANT: the skill name must exactly match its directory name under /skills.
     */
    enabled: string[];
  };

  inference: {
    /**
     * Optional system instruction injected as the ONLY role=system message for all providers.
     */
    system_instruction?: string;

    provider: "openai_compat";
    openai_compat: {
      profiles: OpenAICompatProfile[];
    };
    codex_oauth: {
      profiles: CodexOAuthProfile[];
    };
  };
  adapters: {
    discord: {
      enabled: boolean;
      app_id?: string; // non-secret (application id / client id)
      bot_token?: string; // secret (prefer local overrides)
      guild_ids?: string[]; // optional: register slash commands as guild-scoped

      /**
       * Default stream mode for the /eclia slash command when `verbose` is omitted.
       * - final: no intermediate streaming (default)
       * - full: stream intermediate output (tools/deltas)
       */
      default_stream_mode?: "full" | "final";
    };
  };
};

export type OpenAICompatProfile = {
  /**
   * Stable identifier used by UI/runtime routing.
   * Not shown to users.
   */
  id: string;

  /**
   * Display name (shown in the Console UI).
   */
  name: string;

  /**
   * Example: https://api.openai.com/v1
   */
  base_url: string;

  /**
   * Real upstream model id (NOT the UI route key).
   */
  model: string;

  /**
   * Secret (prefer local overrides).
   */
  api_key?: string;

  /**
   * Default: Authorization
   */
  auth_header?: string;
};
export type CodexOAuthProfile = {
  /**
   * Stable identifier used by UI/runtime routing.
   */
  id: string;

  /**
   * Display name (shown in the Console UI).
   */
  name: string;

  /**
   * Real upstream model id (NOT the UI route key).
   */
  model: string;

  /**
   * Secret OAuth tokens (prefer local overrides).
   *
   * NOTE: for now we treat these as opaque strings; different backends may
   * return different token sets.
   */
  access_token?: string;
  refresh_token?: string;
  id_token?: string;

  /**
   * Epoch milliseconds, if known.
   */
  expires_at?: number;
};


export type EcliaConfigPatch = Partial<{
  codex_home: string;
  console: Partial<EcliaConfig["console"]>;
  api: Partial<EcliaConfig["api"]>;
  debug: Partial<EcliaConfig["debug"]>;
  skills: Partial<EcliaConfig["skills"]>;
  inference: Partial<{
    system_instruction: string;
    provider: EcliaConfig["inference"]["provider"];
    openai_compat: Partial<{
      profiles: Array<
        Partial<Pick<OpenAICompatProfile, "id" | "name" | "base_url" | "model" | "api_key" | "auth_header">> &
          Pick<OpenAICompatProfile, "id">
      >;
    }>;
    codex_oauth: Partial<{
      profiles: Array<
        Partial<Pick<CodexOAuthProfile, "id" | "name" | "model" | "access_token" | "refresh_token" | "id_token" | "expires_at">> &
          Pick<CodexOAuthProfile, "id">
      >;
    }>;
  }>;
  adapters: Partial<{
    discord: Partial<EcliaConfig["adapters"]["discord"]>;
  }>;
}>;

export const DEFAULT_ECLIA_CONFIG: EcliaConfig = {
  console: { host: "127.0.0.1", port: 5173 },
  api: { port: 8787 },
  debug: {
    capture_upstream_requests: false
  },
  skills: {
    enabled: []
  },
  inference: {
    provider: "openai_compat",
    openai_compat: {
      profiles: [
        {
          id: "default",
          name: "Default",
          base_url: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          auth_header: "Authorization"
        }
      ]
    },
    codex_oauth: {
      profiles: [
        {
          id: "default",
          name: "Default",
          // Codex app-server model id (not the UI route key).
          model: "gpt-5.2-codex"
        }
      ]
    }
  },
  adapters: {
    discord: {
      enabled: false,
      guild_ids: [],
      default_stream_mode: "final"
    }
  }
};

function coerceDiscordStreamMode(v: unknown, fallback: "full" | "final"): "full" | "final" {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (s === "full" || s === "final") return s;
  return fallback;
}

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

function coerceOptionalString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

function coerceOptionalNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

function coerceProfileId(v: unknown, fallback: string): string {
  if (typeof v === "string") {
    const s = v.trim();
    if (s) return s;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  return fallback;
}

function coerceStringArray(v: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const x of v) {
      const s = typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "";
      if (!s) continue;
      out.push(s);
    }
    return out;
  }

  if (typeof v === "string") {
    const out = v
      .split(/[\n\r,\t\s]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
    return out.length ? out : fallback;
  }

  return fallback;
}


function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  }
  return fallback;
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

  const codex_home = coerceOptionalString((raw as any).codex_home);

  const consoleRaw = isRecord(raw.console) ? raw.console : {};
  const apiRaw = isRecord(raw.api) ? raw.api : {};
  const debugRaw = isRecord((raw as any).debug) ? ((raw as any).debug as any) : {};
  const skillsRaw = isRecord((raw as any).skills) ? ((raw as any).skills as any) : {};
  const infRaw = isRecord(raw.inference) ? raw.inference : {};

  const openaiRaw = isRecord((infRaw as any).openai_compat) ? (infRaw as any).openai_compat : {};

  const codexRaw = isRecord((infRaw as any).codex_oauth) ? (infRaw as any).codex_oauth : {};

  const adaptersRaw = isRecord(raw.adapters) ? raw.adapters : {};
  const discordRaw = isRecord((adaptersRaw as any).discord) ? (adaptersRaw as any).discord : {};

  const provider = (infRaw as any).provider === "openai_compat" ? "openai_compat" : base.inference.provider;

  const system_instruction = coerceOptionalString((infRaw as any).system_instruction);

  // Profiles (new schema). If missing/empty, fall back to legacy keys on [inference.openai_compat].
  const rawProfiles = Array.isArray((openaiRaw as any).profiles) ? ((openaiRaw as any).profiles as any[]) : null;

  const profiles: OpenAICompatProfile[] = [];
  const seen = new Set<string>();

  if (rawProfiles && rawProfiles.length) {
    for (let i = 0; i < rawProfiles.length; i++) {
      const p = rawProfiles[i];
      if (!isRecord(p)) continue;

      const id = coerceProfileId(p.id, `profile_${i + 1}`);
      if (seen.has(id)) continue;
      seen.add(id);

      const name = coerceString(p.name, `Profile ${i + 1}`);
      const base_url = coerceString(p.base_url, base.inference.openai_compat.profiles[0].base_url);
      const model = coerceString(p.model, base.inference.openai_compat.profiles[0].model);
      const api_key = coerceOptionalString(p.api_key);
      const auth_header = coerceString(p.auth_header, base.inference.openai_compat.profiles[0].auth_header ?? "Authorization");

      profiles.push({ id, name, base_url, model, api_key, auth_header });
    }
  }

  // Legacy schema fallback: base_url/model/api_key/auth_header at [inference.openai_compat]
  if (profiles.length === 0) {
    profiles.push({
      id: "default",
      name: "Default",
      base_url: coerceString(openaiRaw.base_url, base.inference.openai_compat.profiles[0].base_url),
      model: coerceString(openaiRaw.model, base.inference.openai_compat.profiles[0].model),
      api_key: coerceOptionalString(openaiRaw.api_key),
      auth_header: coerceString(openaiRaw.auth_header, base.inference.openai_compat.profiles[0].auth_header ?? "Authorization")
    });
  }
  // Codex OAuth (optional; used for ChatGPT/Codex browser login tokens).
  const codexProfilesRaw = Array.isArray((codexRaw as any).profiles) ? ((codexRaw as any).profiles as any[]) : null;
  const codexProfiles: CodexOAuthProfile[] = [];
  const seenCodex = new Set<string>();

  if (codexProfilesRaw && codexProfilesRaw.length) {
    // ECLIA supports a single Codex OAuth profile (Codex auth is global).
    // If multiple profiles are present in TOML, we keep the first valid one.
    for (let i = 0; i < codexProfilesRaw.length; i++) {
      const p = codexProfilesRaw[i];
      if (!isRecord(p)) continue;

      const id = coerceProfileId((p as any).id, "default");
      if (seenCodex.has(id)) continue;
      seenCodex.add(id);

      const name = coerceString((p as any).name, "Default");
      const model = coerceString(
        (p as any).model,
        base.inference.codex_oauth.profiles[0]?.model ?? base.inference.openai_compat.profiles[0].model
      );

      const access_token = coerceOptionalString((p as any).access_token);
      const refresh_token = coerceOptionalString((p as any).refresh_token);
      const id_token = coerceOptionalString((p as any).id_token);
      const expires_at = coerceOptionalNumber((p as any).expires_at);

      codexProfiles.push({ id: "default", name, model, access_token, refresh_token, id_token, expires_at });
      break;
    }
  }

  // If config omits Codex profiles, fall back to DEFAULT_ECLIA_CONFIG.
  const codexProfilesOut = (codexProfiles.length ? codexProfiles : base.inference.codex_oauth.profiles).slice(0, 1);

  return {
    ...(codex_home ? { codex_home } : {}),
    console: {
      host: coerceHost(consoleRaw.host, base.console.host),
      port: clampPort(consoleRaw.port, base.console.port)
    },
    api: {
      port: clampPort(apiRaw.port, base.api.port)
    },
    debug: {
      capture_upstream_requests: coerceBool((debugRaw as any).capture_upstream_requests, base.debug.capture_upstream_requests)
    },
    skills: {
      enabled: coerceStringArray((skillsRaw as any).enabled, base.skills.enabled ?? [])
    },
    inference: {
      ...(system_instruction ? { system_instruction } : {}),
      provider,
      openai_compat: {
        profiles
      },
      codex_oauth: {
        profiles: codexProfilesOut
      }
    },
    adapters: {
      discord: {
        enabled: coerceBool(discordRaw.enabled, base.adapters.discord.enabled),
        app_id:
          typeof discordRaw.app_id === "string" && discordRaw.app_id.trim().length
            ? discordRaw.app_id.trim()
            : undefined,
        bot_token: typeof discordRaw.bot_token === "string" ? discordRaw.bot_token : undefined,
        guild_ids: coerceStringArray((discordRaw as any).guild_ids, base.adapters.discord.guild_ids ?? []),
        default_stream_mode: coerceDiscordStreamMode(
          (discordRaw as any).default_stream_mode,
          (base.adapters.discord.default_stream_mode ?? "final") as any
        )
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

  // Special-case: profiles are an array, so deepMerge() replaces wholesale.
  // Preserve existing secrets (api_key) per profile id unless the patch explicitly sets a new one.
  const currentProfilesRaw = (currentLocal as any)?.inference?.openai_compat?.profiles;
  const currentProfiles = Array.isArray(currentProfilesRaw) ? (currentProfilesRaw as any[]) : null;
  const legacyKey = coerceOptionalString((currentLocal as any)?.inference?.openai_compat?.api_key);
  const legacyAuthHeader = coerceOptionalString((currentLocal as any)?.inference?.openai_compat?.auth_header);

  if (patch.inference?.openai_compat && Array.isArray((patch.inference.openai_compat as any).profiles)) {
    const patched = (patch.inference.openai_compat as any).profiles as any[];
    const preserved: any[] = [];

    for (let i = 0; i < patched.length; i++) {
      const p = patched[i];
      if (!isRecord(p)) continue;

      const id = coerceProfileId(p.id, `profile_${i + 1}`);
      const existing = currentProfiles?.find((x) => isRecord(x) && coerceProfileId((x as any).id, "") === id);

      const next: Record<string, any> = { ...p, id };

      // Preserve api_key when omitted.
      if (!Object.prototype.hasOwnProperty.call(p, "api_key")) {
        const existingKey = coerceOptionalString((existing as any)?.api_key);
        if (existingKey) next.api_key = existingKey;
        // Legacy fallback: if user is migrating from the old single-key schema.
        if (!existingKey && id === "default" && legacyKey) next.api_key = legacyKey;
      }

      // Preserve auth_header when omitted (old configs may have it only at the top-level).
      if (!Object.prototype.hasOwnProperty.call(p, "auth_header")) {
        const existingHeader = coerceOptionalString((existing as any)?.auth_header);
        if (existingHeader) next.auth_header = existingHeader;
        if (!existingHeader && id === "default" && legacyAuthHeader) next.auth_header = legacyAuthHeader;
      }

      preserved.push(next);
    }

    (patch.inference.openai_compat as any).profiles = preserved;
  }

  const nextLocal = deepMerge(currentLocal, patch as any);

  // Normalize known keys, but keep everything else.
  const normalized = coerceConfig(nextLocal);

  // Rebuild known sections on top of the merged object so types are stable.
  const toWrite: Record<string, any> = {
    ...nextLocal,
    console: { host: normalized.console.host, port: normalized.console.port },
    api: { port: normalized.api.port },
    debug: {
      ...(isRecord((nextLocal as any).debug) ? (nextLocal as any).debug : {}),
      capture_upstream_requests: normalized.debug.capture_upstream_requests
    },
    skills: {
      ...(isRecord((nextLocal as any).skills) ? (nextLocal as any).skills : {}),
      enabled: normalized.skills.enabled
    },
    inference: {
      ...(isRecord(nextLocal.inference) ? nextLocal.inference : {}),
      provider: normalized.inference.provider,
      openai_compat: {
        ...(isRecord(nextLocal.inference?.openai_compat) ? (nextLocal.inference as any).openai_compat : {}),
        profiles: normalized.inference.openai_compat.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          base_url: p.base_url,
          model: p.model,
          auth_header: p.auth_header
        }))
      }
    },
    adapters: {
      ...(isRecord((nextLocal as any).adapters) ? (nextLocal as any).adapters : {}),
      discord: {
        ...(isRecord((nextLocal as any)?.adapters?.discord) ? (nextLocal as any).adapters.discord : {}),
        enabled: normalized.adapters.discord.enabled
      }
    }
  };

  // skills.enabled: omit the whole [skills] table when it would be empty AND
  // it doesn't contain any other user-defined keys.
  {
    const rawSkills = isRecord((nextLocal as any).skills) ? ((nextLocal as any).skills as Record<string, any>) : null;
    const hasOtherKeys = rawSkills ? Object.keys(rawSkills).some((k) => k !== "enabled") : false;
    if (!hasOtherKeys && normalized.skills.enabled.length === 0) {
      delete (toWrite as any).skills;
    }
  }

  // debug.capture_upstream_requests: omit the whole [debug] table when it would be default (false)
  // AND it doesn't contain any other user-defined keys.
  {
    const rawDebug = isRecord((nextLocal as any).debug) ? ((nextLocal as any).debug as Record<string, any>) : null;
    const hasOtherKeys = rawDebug ? Object.keys(rawDebug).some((k) => k !== "capture_upstream_requests") : false;
    if (!hasOtherKeys && normalized.debug.capture_upstream_requests === false) {
      delete (toWrite as any).debug;
    }
  }

  // inference.system_instruction: write only when non-empty; otherwise remove from TOML.
  if (normalized.inference.system_instruction) (toWrite as any).inference.system_instruction = normalized.inference.system_instruction;
  else delete (toWrite as any).inference.system_instruction;

  // codex_home: write only if configured; otherwise omit from TOML.
  const codexHome = coerceOptionalString((nextLocal as any).codex_home);
  if (codexHome) (toWrite as any).codex_home = codexHome;
  else delete (toWrite as any).codex_home;

  // inference.openai_compat.profiles[].api_key: only write keys that exist in the file.
  const nextProfilesRaw = (nextLocal as any)?.inference?.openai_compat?.profiles;
  if (Array.isArray(nextProfilesRaw)) {
    const byId = new Map<string, any>();
    for (const p of nextProfilesRaw) {
      if (!isRecord(p)) continue;
      const id = coerceProfileId((p as any).id, "");
      if (!id) continue;
      byId.set(id, p);
    }

    const out = (toWrite as any).inference.openai_compat.profiles as any[];
    for (let i = 0; i < out.length; i++) {
      const row = out[i];
      const raw = byId.get(String(row.id));
      const key = coerceOptionalString((raw as any)?.api_key);
      if (key) row.api_key = key;
    }
  }

  // adapters.discord.bot_token: only write if present in patch OR already present in file
  const hasDiscordToken = typeof (nextLocal as any)?.adapters?.discord?.bot_token === "string";
  if (hasDiscordToken) {
    (toWrite as any).adapters.discord.bot_token = (nextLocal as any).adapters.discord.bot_token;
  }

  // adapters.discord.app_id: only write if present in patch OR already present in file
  const hasDiscordAppId = typeof (nextLocal as any)?.adapters?.discord?.app_id === "string";
  if (hasDiscordAppId) {
    (toWrite as any).adapters.discord.app_id = (nextLocal as any).adapters.discord.app_id;
  }

  // adapters.discord.guild_ids: write if present in patch OR already present in file
  const hasDiscordGuildIds = Array.isArray((nextLocal as any)?.adapters?.discord?.guild_ids);
  if (hasDiscordGuildIds) {
    (toWrite as any).adapters.discord.guild_ids = normalized.adapters.discord.guild_ids ?? [];
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
  const sel = resolveInferenceSelection(k, config);
  return sel.upstreamModel;
}

export type InferenceSelection =
  | { kind: "openai_compat"; profile: OpenAICompatProfile; upstreamModel: string }
  | { kind: "codex_oauth"; profile: CodexOAuthProfile; upstreamModel: string };

/**
 * Resolve which upstream backend should be used for a given runtime route key.
 *
 * Today we support:
 * - OpenAI-compatible profiles: openai-compatible:<profile-id>
 * - Codex OAuth profiles: codex-oauth:<profile-id>
 */
export function resolveInferenceSelection(routeKey: string, config: EcliaConfig): InferenceSelection {
  const k = (routeKey ?? "").trim();

  // Codex route format: codex-oauth:<profile-id>
  if (/^codex-oauth(?::|$)/.test(k)) {
    const sel = resolveCodexOAuthSelection(k, config);
    return { kind: "codex_oauth", ...sel };
  }

  // Default/fallback: OpenAI-compatible.
  const sel = resolveOpenAICompatSelection(k, config);
  return { kind: "openai_compat", ...sel };
}

export function resolveCodexOAuthSelection(
  routeKey: string,
  config: EcliaConfig
): { profile: CodexOAuthProfile; upstreamModel: string } {
  const k = (routeKey ?? "").trim();
  const profiles = config.inference.codex_oauth?.profiles ?? [];

  const fallback = profiles[0];
  if (!fallback) {
    throw new Error("No Codex OAuth profiles configured");
  }

  // Primary route format: codex-oauth:<profile-id>
  const m = k.match(/^codex-oauth:(.+)$/);
  if (m) {
    const id = m[1]?.trim();
    const profile = profiles.find((p) => p.id === id) ?? fallback;
    return { profile, upstreamModel: profile.model };
  }

  // Legacy / shorthand route keys.
  if (k === "codex-oauth" || !k) {
    return { profile: fallback, upstreamModel: fallback.model };
  }

  // If someone passes an unknown codex-oauth-ish key, still fall back.
  return { profile: fallback, upstreamModel: fallback.model };
}

export function resolveOpenAICompatSelection(
  routeKey: string,
  config: EcliaConfig
): { profile: OpenAICompatProfile; upstreamModel: string } {
  const k = (routeKey ?? "").trim();
  const profiles = config.inference.openai_compat.profiles;
  const fallback = profiles[0] ?? DEFAULT_ECLIA_CONFIG.inference.openai_compat.profiles[0];

  // Primary route format: openai-compatible:<profile-id>
  const m = k.match(/^openai-compatible:(.+)$/);
  if (m) {
    const id = m[1]?.trim();
    const profile = profiles.find((p) => p.id === id) ?? fallback;
    return { profile, upstreamModel: profile.model };
  }

  // Legacy UI route keys.
  if (k === "openai-compatible" || k === "router/gateway" || k === "local/ollama" || !k) {
    return { profile: fallback, upstreamModel: fallback.model };
  }

  // If the UI sends a real model id, pass through while using the default profile.
  return { profile: fallback, upstreamModel: k };
}
