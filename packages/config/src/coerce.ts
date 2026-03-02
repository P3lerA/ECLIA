import type { AnthropicProfile, CodexOAuthProfile, EcliaConfig, OpenAICompatProfile } from "./types.js";
import { DEFAULT_ECLIA_CONFIG } from "./types.js";
import {
  ANTHROPIC_DEFAULT_AUTH_HEADER,
  ANTHROPIC_DEFAULT_VERSION,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  OPENAI_COMPAT_DEFAULT_AUTH_HEADER,
  isInferenceProviderId
} from "./provider-defaults.js";

function coerceDiscordStreamMode(v: unknown, fallback: "full" | "final"): "full" | "final" {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (s === "full" || s === "final") return s;
  return fallback;
}

function coerceEmailListenerTarget(v: unknown): any {
  if (!isRecord(v)) return null;
  const kind = typeof (v as any).kind === "string" ? String((v as any).kind).trim().toLowerCase() : "";
  if (kind === "discord") {
    const channel_id = coerceOptionalString((v as any).channel_id ?? (v as any).channelId);
    return channel_id ? { kind: "discord", channel_id } : null;
  }
  if (kind === "telegram") {
    const chat_id = coerceOptionalString((v as any).chat_id ?? (v as any).chatId);
    return chat_id ? { kind: "telegram", chat_id } : null;
  }
  return null;
}

function coerceEmailListenerAccounts(v: unknown): any[] {
  if (!Array.isArray(v)) return [];
  const out: any[] = [];

  for (let i = 0; i < v.length; i++) {
    const raw = v[i];
    if (!isRecord(raw)) continue;
    const id = coerceProfileId((raw as any).id, `account_${i + 1}`);
    const host = coerceOptionalString((raw as any).host) ?? "";
    const port = clampPort((raw as any).port, 993);
    const secure = coerceBool((raw as any).secure, true);
    const user = coerceOptionalString((raw as any).user) ?? "";
    const pass = coerceOptionalString((raw as any).pass);
    const mailbox = coerceOptionalString((raw as any).mailbox) ?? undefined;
    const criterion = typeof (raw as any).criterion === "string" ? String((raw as any).criterion) : "";
    const model = coerceOptionalString((raw as any).model);
    const notify = coerceEmailListenerTarget((raw as any).notify);
    const start_from = "now";
    const max_body_chars = typeof (raw as any).max_body_chars === "number" ? Math.max(0, Math.trunc((raw as any).max_body_chars)) : undefined;

    if (!host || !user || !notify) continue;
    out.push({
      id,
      host,
      port,
      secure,
      user,
      ...(pass ? { pass } : {}),
      ...(mailbox ? { mailbox } : {}),
      criterion,
      ...(model ? { model } : {}),
      notify,
      start_from,
      ...(typeof max_body_chars === "number" ? { max_body_chars } : {})
    });
  }
  return out;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampPort(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 1 || i > 65535) return fallback;
  return i;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min || i > max) return fallback;
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

export function coerceOptionalString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

function coerceOptionalNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

export function coerceProfileId(v: unknown, fallback: string): string {
  if (typeof v === "string") {
    const s = v.trim();
    if (s) return s;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  return fallback;
}

export function coerceStringArray(v: unknown, fallback: string[] = []): string[] {
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

export function deepMerge(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (isRecord(v) && isRecord(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

export function coerceConfig(raw: Record<string, any>): EcliaConfig {
  const base = DEFAULT_ECLIA_CONFIG;

  const codex_home = coerceOptionalString((raw as any).codex_home);

  const consoleRaw = isRecord(raw.console) ? raw.console : {};
  const apiRaw = isRecord(raw.api) ? raw.api : {};
  const memoryRaw = isRecord((raw as any).memory) ? ((raw as any).memory as any) : {};
  const debugRaw = isRecord((raw as any).debug) ? ((raw as any).debug as any) : {};
  const skillsRaw = isRecord((raw as any).skills) ? ((raw as any).skills as any) : {};
  const personaRaw = isRecord((raw as any).persona) ? ((raw as any).persona as any) : {};
  const infRaw = isRecord(raw.inference) ? raw.inference : {};

  const openaiRaw = isRecord((infRaw as any).openai_compat) ? (infRaw as any).openai_compat : {};

  const anthropicRaw = isRecord((infRaw as any).anthropic) ? (infRaw as any).anthropic : {};

  const codexRaw = isRecord((infRaw as any).codex_oauth) ? (infRaw as any).codex_oauth : {};

  const adaptersRaw = isRecord(raw.adapters) ? raw.adapters : {};
  const discordRaw = isRecord((adaptersRaw as any).discord) ? (adaptersRaw as any).discord : {};
  const telegramRaw = isRecord((adaptersRaw as any).telegram) ? (adaptersRaw as any).telegram : {};

  const pluginsRaw = isRecord((raw as any).plugins) ? ((raw as any).plugins as any) : {};
  const listenerRaw = isRecord((pluginsRaw as any).listener) ? (pluginsRaw as any).listener : {};
  const emailListenerRaw = isRecord((listenerRaw as any).email) ? (listenerRaw as any).email : {};
  const emailListener = emailListenerRaw;

  const providerRaw = typeof (infRaw as any).provider === "string" ? String((infRaw as any).provider).trim() : "";
  const provider = isInferenceProviderId(providerRaw) ? providerRaw : base.inference.provider;

  const system_instruction = coerceOptionalString((infRaw as any).system_instruction);
  const user_preferred_name = coerceOptionalString((personaRaw as any).user_preferred_name);
  const assistant_name = coerceOptionalString((personaRaw as any).assistant_name);

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
      const auth_header = coerceString(p.auth_header, base.inference.openai_compat.profiles[0].auth_header ?? OPENAI_COMPAT_DEFAULT_AUTH_HEADER);

      profiles.push({ id, name, base_url, model, api_key, auth_header });
    }
  }

  // Legacy schema fallback: base_url/model/api_key/auth_header at [inference.openai_compat]
  if (profiles.length === 0) {
    profiles.push({
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      base_url: coerceString(openaiRaw.base_url, base.inference.openai_compat.profiles[0].base_url),
      model: coerceString(openaiRaw.model, base.inference.openai_compat.profiles[0].model),
      api_key: coerceOptionalString(openaiRaw.api_key),
      auth_header: coerceString(openaiRaw.auth_header, base.inference.openai_compat.profiles[0].auth_header ?? OPENAI_COMPAT_DEFAULT_AUTH_HEADER)
    });
  }

  // Anthropic (Messages API)
  const anthropicProfilesRaw = Array.isArray((anthropicRaw as any).profiles) ? ((anthropicRaw as any).profiles as any[]) : null;
  const anthropicProfiles: AnthropicProfile[] = [];
  const seenAnthropic = new Set<string>();

  if (anthropicProfilesRaw && anthropicProfilesRaw.length) {
    for (let i = 0; i < anthropicProfilesRaw.length; i++) {
      const p = anthropicProfilesRaw[i];
      if (!isRecord(p)) continue;

      const id = coerceProfileId((p as any).id, `profile_${i + 1}`);
      if (seenAnthropic.has(id)) continue;
      seenAnthropic.add(id);

      const name = coerceString((p as any).name, `Profile ${i + 1}`);
      const base_url = coerceString((p as any).base_url, base.inference.anthropic.profiles[0].base_url);
      const model = coerceString((p as any).model, base.inference.anthropic.profiles[0].model);
      const api_key = coerceOptionalString((p as any).api_key);
      const auth_header = coerceString((p as any).auth_header, base.inference.anthropic.profiles[0].auth_header ?? ANTHROPIC_DEFAULT_AUTH_HEADER);
      const anthropic_version = coerceString(
        (p as any).anthropic_version,
        base.inference.anthropic.profiles[0].anthropic_version ?? ANTHROPIC_DEFAULT_VERSION
      );

      anthropicProfiles.push({ id, name, base_url, model, api_key, auth_header, anthropic_version });
    }
  }

  // Legacy schema fallback: base_url/model/api_key/auth_header/anthropic_version at [inference.anthropic]
  if (anthropicProfiles.length === 0) {
    anthropicProfiles.push({
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      base_url: coerceString((anthropicRaw as any).base_url, base.inference.anthropic.profiles[0].base_url),
      model: coerceString((anthropicRaw as any).model, base.inference.anthropic.profiles[0].model),
      api_key: coerceOptionalString((anthropicRaw as any).api_key),
      auth_header: coerceString((anthropicRaw as any).auth_header, base.inference.anthropic.profiles[0].auth_header ?? ANTHROPIC_DEFAULT_AUTH_HEADER),
      anthropic_version: coerceString(
        (anthropicRaw as any).anthropic_version,
        base.inference.anthropic.profiles[0].anthropic_version ?? ANTHROPIC_DEFAULT_VERSION
      )
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

      const id = coerceProfileId((p as any).id, DEFAULT_PROFILE_ID);
      if (seenCodex.has(id)) continue;
      seenCodex.add(id);

      const name = coerceString((p as any).name, DEFAULT_PROFILE_NAME);
      const model = coerceString(
        (p as any).model,
        base.inference.codex_oauth.profiles[0]?.model ?? base.inference.openai_compat.profiles[0].model
      );

      const access_token = coerceOptionalString((p as any).access_token);
      const refresh_token = coerceOptionalString((p as any).refresh_token);
      const id_token = coerceOptionalString((p as any).id_token);
      const expires_at = coerceOptionalNumber((p as any).expires_at);

      codexProfiles.push({ id: DEFAULT_PROFILE_ID, name, model, access_token, refresh_token, id_token, expires_at });
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
    memory: {
      enabled: coerceBool((memoryRaw as any).enabled, base.memory.enabled),
      host: coerceHost((memoryRaw as any).host, base.memory.host),
      port: clampPort((memoryRaw as any).port, base.memory.port),
      recent_turns: clampInt((memoryRaw as any).recent_turns, 0, 64, base.memory.recent_turns),
      recall_limit: clampInt((memoryRaw as any).recall_limit, 0, 200, base.memory.recall_limit),
      timeout_ms: clampInt((memoryRaw as any).timeout_ms, 50, 60_000, base.memory.timeout_ms),
      embeddings: {
        model: coerceString(((memoryRaw as any) as any)?.embeddings?.model, base.memory.embeddings.model)
      }
    },
    debug: {
      capture_upstream_requests: coerceBool((debugRaw as any).capture_upstream_requests, base.debug.capture_upstream_requests),
      parse_assistant_output: coerceBool((debugRaw as any).parse_assistant_output, (base.debug as any).parse_assistant_output ?? false)
    },
    skills: {
      enabled: coerceStringArray((skillsRaw as any).enabled, base.skills.enabled ?? [])
    },
    persona: {
      ...(user_preferred_name ? { user_preferred_name } : {}),
      ...(assistant_name ? { assistant_name } : {})
    },
    inference: {
      ...(system_instruction ? { system_instruction } : {}),
      provider,
      openai_compat: {
        profiles
      },
      anthropic: {
        profiles: anthropicProfiles.length ? anthropicProfiles : base.inference.anthropic.profiles
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
        user_whitelist: coerceStringArray((discordRaw as any).user_whitelist, (base.adapters.discord as any).user_whitelist ?? []),
        force_global_commands: coerceBool(
          (discordRaw as any).force_global_commands,
          Boolean((base.adapters.discord as any).force_global_commands ?? false)
        ),
        default_stream_mode: coerceDiscordStreamMode(
          (discordRaw as any).default_stream_mode,
          (base.adapters.discord.default_stream_mode ?? "final") as any
        )
      },

      telegram: {
        enabled: coerceBool((telegramRaw as any).enabled, base.adapters.telegram.enabled),
        bot_token: typeof (telegramRaw as any).bot_token === "string" ? (telegramRaw as any).bot_token : undefined,
        user_whitelist: coerceStringArray((telegramRaw as any).user_whitelist, (base.adapters.telegram as any).user_whitelist ?? []),
        group_whitelist: coerceStringArray((telegramRaw as any).group_whitelist, (base.adapters.telegram as any).group_whitelist ?? [])
      }
    },
    plugins: {
      listener: {
        email: {
          enabled: coerceBool((emailListener as any).enabled, base.plugins.listener.email.enabled),
          ...(coerceOptionalString((emailListener as any).triage_prompt) ? { triage_prompt: String((emailListener as any).triage_prompt) } : {}),
          accounts: coerceEmailListenerAccounts((emailListener as any).accounts)
        }
      }
    }
  };
}
