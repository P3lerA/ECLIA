/// <reference path="./iarna__toml.d.ts" />

import fs from "node:fs";
import path from "node:path";
import * as TOML from "@iarna/toml";

import { coerceConfig, coerceOptionalString, coerceProfileId, deepMerge, isRecord } from "./coerce.js";
import { findProjectRoot } from "./root.js";
import { ensureSystemInstructionFiles, readSystemInstruction, writeSystemInstructionLocal } from "./system-instruction.js";
import { DEFAULT_PROFILE_ID } from "./provider-defaults.js";
import type { EcliaConfig, EcliaConfigPatch } from "./types.js";

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
  ensureSystemInstructionFiles(rootDir);

  const base = tryReadToml(configPath);
  const local = tryReadToml(localPath);

  const merged = deepMerge(base, local);
  const config = coerceConfig(merged);
  const systemInstruction = readSystemInstruction(rootDir);
  (config.inference as any).system_instruction = systemInstruction.text;

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
  ensureSystemInstructionFiles(rootDir);

  let patchSystemInstruction: string | undefined;
  if (patch.inference && Object.prototype.hasOwnProperty.call(patch.inference, "system_instruction")) {
    const raw = (patch.inference as any).system_instruction;
    if (typeof raw === "string") patchSystemInstruction = raw;

    const nextInferencePatch: Record<string, any> = { ...(patch.inference as any) };
    delete nextInferencePatch.system_instruction;
    patch = {
      ...patch,
      inference: nextInferencePatch as any
    };
  }

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
        if (!existingKey && id === DEFAULT_PROFILE_ID && legacyKey) next.api_key = legacyKey;
      }

      // Preserve auth_header when omitted (old configs may have it only at the top-level).
      if (!Object.prototype.hasOwnProperty.call(p, "auth_header")) {
        const existingHeader = coerceOptionalString((existing as any)?.auth_header);
        if (existingHeader) next.auth_header = existingHeader;
        if (!existingHeader && id === DEFAULT_PROFILE_ID && legacyAuthHeader) next.auth_header = legacyAuthHeader;
      }

      preserved.push(next);
    }

    (patch.inference.openai_compat as any).profiles = preserved;
  }

  // Special-case: Anthropic profiles are also an array, so deepMerge() replaces wholesale.
  // Preserve existing secrets (api_key) per profile id unless the patch explicitly sets a new one.
  {
    const currentAnthropicProfilesRaw = (currentLocal as any)?.inference?.anthropic?.profiles;
    const currentAnthropicProfiles = Array.isArray(currentAnthropicProfilesRaw) ? (currentAnthropicProfilesRaw as any[]) : null;
    const legacyKey = coerceOptionalString((currentLocal as any)?.inference?.anthropic?.api_key);
    const legacyAuthHeader = coerceOptionalString((currentLocal as any)?.inference?.anthropic?.auth_header);
    const legacyVersion = coerceOptionalString((currentLocal as any)?.inference?.anthropic?.anthropic_version);

    if (patch.inference?.anthropic && Array.isArray((patch.inference.anthropic as any).profiles)) {
      const patched = (patch.inference.anthropic as any).profiles as any[];
      const preserved: any[] = [];

      for (let i = 0; i < patched.length; i++) {
        const p = patched[i];
        if (!isRecord(p)) continue;

        const id = coerceProfileId((p as any).id, `profile_${i + 1}`);
        const existing = currentAnthropicProfiles?.find((x) => isRecord(x) && coerceProfileId((x as any).id, "") === id);

        const next: Record<string, any> = { ...p, id };

        if (!Object.prototype.hasOwnProperty.call(p, "api_key")) {
          const existingKey = coerceOptionalString((existing as any)?.api_key);
          if (existingKey) next.api_key = existingKey;
          if (!existingKey && id === DEFAULT_PROFILE_ID && legacyKey) next.api_key = legacyKey;
        }

        if (!Object.prototype.hasOwnProperty.call(p, "auth_header")) {
          const existingHeader = coerceOptionalString((existing as any)?.auth_header);
          if (existingHeader) next.auth_header = existingHeader;
          if (!existingHeader && id === DEFAULT_PROFILE_ID && legacyAuthHeader) next.auth_header = legacyAuthHeader;
        }

        if (!Object.prototype.hasOwnProperty.call(p, "anthropic_version")) {
          const existingVersion = coerceOptionalString((existing as any)?.anthropic_version);
          if (existingVersion) next.anthropic_version = existingVersion;
          if (!existingVersion && id === DEFAULT_PROFILE_ID && legacyVersion) next.anthropic_version = legacyVersion;
        }

        preserved.push(next);
      }

      (patch.inference.anthropic as any).profiles = preserved;
    }
  }

  // Special-case: tools.web.profiles is also an array, so deepMerge() replaces wholesale.
  // Preserve existing secrets (api_key) per profile id unless the patch explicitly sets a new one.
  {
    const patchToolsWeb = (patch as any)?.tools?.web;
    const patchedProfilesRaw = patchToolsWeb?.profiles;

    const currentWebProfilesRaw = (currentLocal as any)?.tools?.web?.profiles;
    const currentWebProfiles = Array.isArray(currentWebProfilesRaw) ? (currentWebProfilesRaw as any[]) : null;

    const legacyTavilyKey =
      coerceOptionalString((currentLocal as any)?.tools?.web?.tavily?.api_key) ||
      coerceOptionalString((currentLocal as any)?.tools?.tavily?.api_key) ||
      coerceOptionalString((currentLocal as any)?.tavily_api_key);

    const activeId =
      coerceOptionalString(patchToolsWeb?.active_profile) ||
      coerceOptionalString((currentLocal as any)?.tools?.web?.active_profile) ||
      DEFAULT_PROFILE_ID;

    if (patchToolsWeb && Array.isArray(patchedProfilesRaw)) {
      const patched = patchedProfilesRaw as any[];
      const preserved: any[] = [];

      for (let i = 0; i < patched.length; i++) {
        const p = patched[i];
        if (!isRecord(p)) continue;

        const id = coerceProfileId((p as any).id, `profile_${i + 1}`);
        const existing = currentWebProfiles?.find((x) => isRecord(x) && coerceProfileId((x as any).id, "") === id);

        const next: Record<string, any> = { ...p, id };

        // Preserve api_key when omitted.
        if (!Object.prototype.hasOwnProperty.call(p, "api_key")) {
          const existingKey = coerceOptionalString((existing as any)?.api_key);
          if (existingKey) next.api_key = existingKey;
          // Legacy fallback: if user is migrating from older Tavily-only schema.
          if (!existingKey && id === activeId && legacyTavilyKey) next.api_key = legacyTavilyKey;
        }

        preserved.push(next);
      }

      patchToolsWeb.profiles = preserved;
      (patch as any).tools.web = patchToolsWeb;
    }
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
      capture_upstream_requests: normalized.debug.capture_upstream_requests,
      parse_assistant_output: (normalized.debug as any).parse_assistant_output ?? false
    },
    skills: {
      ...(isRecord((nextLocal as any).skills) ? (nextLocal as any).skills : {}),
      enabled: normalized.skills.enabled
    },
    persona: {
      ...(isRecord((nextLocal as any).persona) ? (nextLocal as any).persona : {}),
      ...(normalized.persona.user_preferred_name ? { user_preferred_name: normalized.persona.user_preferred_name } : {}),
      ...(normalized.persona.assistant_name ? { assistant_name: normalized.persona.assistant_name } : {})
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
      },
      anthropic: {
        ...(isRecord((nextLocal.inference as any)?.anthropic) ? (nextLocal.inference as any).anthropic : {}),
        profiles: normalized.inference.anthropic.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          base_url: p.base_url,
          model: p.model,
          auth_header: p.auth_header,
          anthropic_version: p.anthropic_version
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

  // persona.*: omit the whole [persona] table when it would be empty and it has no other keys.
  {
    const rawPersona = isRecord((nextLocal as any).persona) ? ((nextLocal as any).persona as Record<string, any>) : null;
    const hasOtherKeys = rawPersona
      ? Object.keys(rawPersona).some((k) => k !== "user_preferred_name" && k !== "assistant_name")
      : false;
    const hasUserPreferredName = Boolean(normalized.persona.user_preferred_name);
    const hasAssistantName = Boolean(normalized.persona.assistant_name);
    if (!hasOtherKeys && !hasUserPreferredName && !hasAssistantName) {
      delete (toWrite as any).persona;
    }
  }

  // debug.capture_upstream_requests: omit the whole [debug] table when it would be default (false)
  // AND it doesn't contain any other user-defined keys.
  {
    const rawDebug = isRecord((nextLocal as any).debug) ? ((nextLocal as any).debug as Record<string, any>) : null;
    const hasOtherKeys = rawDebug ? Object.keys(rawDebug).some((k) => k !== "capture_upstream_requests" && k !== "parse_assistant_output") : false;
    const parseEnabled = Boolean((normalized.debug as any).parse_assistant_output ?? false);
    if (!hasOtherKeys && normalized.debug.capture_upstream_requests === false && parseEnabled === false) {
      delete (toWrite as any).debug;
    }
  }

  // System instruction now lives in _system.local.md (with _system.md fallback), not TOML.
  delete (toWrite as any).inference.system_instruction;

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

  // inference.anthropic.profiles[].api_key: only write keys that exist in the file.
  const nextAnthropicProfilesRaw = (nextLocal as any)?.inference?.anthropic?.profiles;
  if (Array.isArray(nextAnthropicProfilesRaw)) {
    const byId = new Map<string, any>();
    for (const p of nextAnthropicProfilesRaw) {
      if (!isRecord(p)) continue;
      const id = coerceProfileId((p as any).id, "");
      if (!id) continue;
      byId.set(id, p);
    }

    const out = ((toWrite as any).inference?.anthropic?.profiles ?? []) as any[];
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
  if (patchSystemInstruction !== undefined) {
    writeSystemInstructionLocal(rootDir, patchSystemInstruction);
  }

  const { config } = loadEcliaConfig(rootDir);
  return { rootDir, localPath, config };
}
