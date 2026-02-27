import http from "node:http";

import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_WEB_PROVIDER,
  isWebProviderId,
  loadEcliaConfig,
  preflightListen,
  type ConfigApiRequestBody,
  type EcliaConfigPatch,
  writeLocalEcliaConfig
} from "@eclia/config";

import { discoverSkills, validateEnabledSkills } from "../skills/registry.js";

import { json, readJson } from "../httpUtils.js";

export async function handleConfig(req: http.IncomingMessage, res: http.ServerResponse) {
  const { config, raw, rootDir } = loadEcliaConfig(process.cwd());
  const availableSkills = discoverSkills(rootDir);

  if (req.method === "GET") {
    const toolsWeb = ((raw as any)?.tools?.web ?? {}) as any;
    const toolsWebProfilesRaw = Array.isArray(toolsWeb.profiles) ? (toolsWeb.profiles as any[]) : [];
    const toolsWebProfiles: any[] = [];
    const seenWebIds = new Set<string>();

    for (const row of toolsWebProfilesRaw) {
      const id = String(row?.id ?? "").trim();
      if (!id || seenWebIds.has(id)) continue;
      seenWebIds.add(id);
      const rawProvider = typeof row?.provider === "string" ? row.provider.trim() : "";
      const provider = isWebProviderId(rawProvider) ? rawProvider : DEFAULT_WEB_PROVIDER;
      const name = typeof row?.name === "string" && row.name.trim() ? row.name.trim() : id;
      const project_id = typeof row?.project_id === "string" ? row.project_id.trim() : "";
      const api_key_configured = Boolean(typeof row?.api_key === "string" && row.api_key.trim());

      toolsWebProfiles.push({ id, name, provider, project_id, api_key_configured });
    }

    // Back-compat: if user configured Tavily via legacy config paths, surface that as
    // a default profile so the UI doesn't look "empty".
    const legacyTavilyKey =
      String((raw as any)?.tools?.web?.tavily?.api_key ?? (raw as any)?.tools?.tavily?.api_key ?? (raw as any)?.tavily_api_key ?? "").trim();
    const legacyTavilyProject = String((raw as any)?.tools?.web?.tavily?.project_id ?? "").trim();

    if (toolsWebProfiles.length === 0) {
      toolsWebProfiles.push({
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        provider: DEFAULT_WEB_PROVIDER,
        project_id: legacyTavilyProject,
        api_key_configured: Boolean(legacyTavilyKey)
      });
    }

    let toolsWebActiveProfile = typeof toolsWeb.active_profile === "string" ? toolsWeb.active_profile.trim() : "";
    if (!toolsWebProfiles.some((p) => p.id === toolsWebActiveProfile)) {
      toolsWebActiveProfile = toolsWebProfiles[0]?.id ?? DEFAULT_PROFILE_ID;
    }

    // If a legacy Tavily key is present but profiles are configured without api_key, treat the
    // active profile as "configured" for UX (the runtime resolver will fall back to legacy paths).
    if (legacyTavilyKey) {
      const active = toolsWebProfiles.find((p) => p.id === toolsWebActiveProfile);
      if (active && active.provider === DEFAULT_WEB_PROVIDER && !active.api_key_configured) {
        active.api_key_configured = true;
      }
    }

    // Do NOT return secrets.
    return json(res, 200, {
      ok: true,
      config: {
        codex_home: config.codex_home,
        console: config.console,
        api: config.api,
        debug: config.debug,
        persona: {
          user_preferred_name: String((config.persona as any)?.user_preferred_name ?? ""),
          assistant_name: String((config.persona as any)?.assistant_name ?? "")
        },
        skills: {
          enabled: config.skills.enabled,
          available: availableSkills.map((s) => ({ name: s.name, summary: s.summary }))
        },
        inference: {
          system_instruction: (config.inference as any).system_instruction,
          provider: config.inference.provider,
          openai_compat: {
            profiles: config.inference.openai_compat.profiles.map((p) => ({
              id: p.id,
              name: p.name,
              base_url: p.base_url,
              model: p.model,
              auth_header: p.auth_header,
              api_key_configured: Boolean(p.api_key && p.api_key.trim())
            }))
          },
          anthropic: {
            profiles: (config.inference as any).anthropic?.profiles?.map((p: any) => ({
              id: p.id,
              name: p.name,
              base_url: p.base_url,
              model: p.model,
              auth_header: p.auth_header,
              anthropic_version: p.anthropic_version,
              api_key_configured: Boolean(p.api_key && String(p.api_key).trim())
            })) ?? []
          },
          codex_oauth: {
            // ECLIA supports a single Codex OAuth profile (Codex auth is global).
            profiles: (config.inference.codex_oauth?.profiles ?? []).slice(0, 1).map((p) => ({
              id: p.id,
              name: p.name,
              model: p.model
            }))
          }
        },
        adapters: {
          discord: {
            enabled: Boolean(config.adapters.discord.enabled),
            app_id: String(config.adapters.discord.app_id ?? ""),
            guild_ids: Array.isArray((config.adapters.discord as any).guild_ids) ? (config.adapters.discord as any).guild_ids : [],
            user_whitelist: Array.isArray((config.adapters.discord as any).user_whitelist) ? (config.adapters.discord as any).user_whitelist : [],
            force_global_commands: Boolean((config.adapters.discord as any).force_global_commands ?? false),
            default_stream_mode: config.adapters.discord.default_stream_mode,
            app_id_configured: Boolean(config.adapters.discord.app_id && config.adapters.discord.app_id.trim()),
            bot_token_configured: Boolean(config.adapters.discord.bot_token && config.adapters.discord.bot_token.trim())
          },

          telegram: {
            enabled: Boolean((config.adapters as any).telegram?.enabled ?? false),
            user_whitelist: Array.isArray((config.adapters as any).telegram?.user_whitelist) ? (config.adapters as any).telegram.user_whitelist : [],
            group_whitelist: Array.isArray((config.adapters as any).telegram?.group_whitelist) ? (config.adapters as any).telegram.group_whitelist : [],
            bot_token_configured: Boolean((config.adapters as any).telegram?.bot_token && String((config.adapters as any).telegram.bot_token).trim())
          }
        },
        tools: {
          web: {
            active_profile: toolsWebActiveProfile,
            profiles: toolsWebProfiles
          }
        },
        plugins: {
          listener: {
            email: {
              enabled: Boolean((config as any)?.plugins?.listener?.email?.enabled ?? false),
              triage_prompt: String((config as any)?.plugins?.listener?.email?.triage_prompt ?? ""),
              accounts:
                ((config as any)?.plugins?.listener?.email?.accounts ?? []).map((a: any) => ({
                  id: String(a?.id ?? ""),
                  host: String(a?.host ?? ""),
                  port: Number(a?.port ?? 993),
                  secure: Boolean(a?.secure ?? true),
                  user: String(a?.user ?? ""),
                  mailbox: String(a?.mailbox ?? "INBOX"),
                  criterion: String(a?.criterion ?? ""),
                  model: typeof a?.model === "string" ? a.model : undefined,
                  notify: a?.notify,
                  start_from: "now",
                  max_body_chars: typeof a?.max_body_chars === "number" ? a.max_body_chars : undefined,
                  pass_configured: Boolean(a?.pass && String(a.pass).trim())
                })) ?? []
            }
          }
        }
      }
    });
  }

  if (req.method === "PUT") {
    const body = (await readJson(req)) as ConfigApiRequestBody;

    const patch: EcliaConfigPatch = {};

    if (typeof body.codex_home === "string") {
      // Empty string means "unset" (use default).
      patch.codex_home = body.codex_home.trim();
    }
    if (body.persona && typeof body.persona === "object") {
      const personaPatch: any = {};
      if (Object.prototype.hasOwnProperty.call(body.persona, "user_preferred_name")) {
        personaPatch.user_preferred_name =
          typeof body.persona.user_preferred_name === "string" ? body.persona.user_preferred_name.trim() : "";
      }
      if (Object.prototype.hasOwnProperty.call(body.persona, "assistant_name")) {
        personaPatch.assistant_name = typeof body.persona.assistant_name === "string" ? body.persona.assistant_name.trim() : "";
      }
      if (Object.keys(personaPatch).length) {
        patch.persona = personaPatch;
      }
    }
    if (body.console) patch.console = body.console;
    if (body.api) patch.api = body.api;

    // Dev hardening: only allow binding the console to localhost or all interfaces.
    // (Other hostnames/IPs will be supported later when we have a proper edge proxy story.)
    if (typeof patch.console?.host === "string") {
      const host = patch.console.host.trim();
      if (host !== "127.0.0.1" && host !== "0.0.0.0") {
        return json(res, 400, {
          ok: false,
          error: "bad_request",
          hint: "console.host must be either '127.0.0.1' (local only) or '0.0.0.0' (listen on all interfaces)."
        });
      }
      patch.console.host = host;
    }

    const debugPatch: any = {};
    if (body.debug && Object.prototype.hasOwnProperty.call(body.debug, "capture_upstream_requests")) {
      debugPatch.capture_upstream_requests = Boolean((body.debug as any).capture_upstream_requests);
    }
    if (body.debug && Object.prototype.hasOwnProperty.call(body.debug, "parse_assistant_output")) {
      debugPatch.parse_assistant_output = Boolean((body.debug as any).parse_assistant_output);
    }
    if (Object.keys(debugPatch).length) {
      patch.debug = debugPatch;
    }

    if (body.skills && Object.prototype.hasOwnProperty.call(body.skills, "enabled")) {
      const vr = validateEnabledSkills((body.skills as any).enabled, availableSkills);
      if (!vr.ok) {
        return json(res, 400, {
          ok: false,
          error: vr.error,
          hint: vr.hint
        });
      }

      patch.skills = { enabled: vr.enabled };
    }
    if (typeof body.inference?.system_instruction === "string") {
      const s = body.inference.system_instruction.trim();
      patch.inference = { ...(patch.inference ?? {}), system_instruction: s };
    }
    if (body.inference?.openai_compat?.profiles) {
      const raw = body.inference.openai_compat.profiles;
      const out: any[] = [];
      const seen = new Set<string>();

      for (const row of raw) {
        const id = String(row?.id ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const next: any = { id };
        if (typeof row.name === "string" && row.name.trim()) next.name = row.name.trim();
        if (typeof row.base_url === "string" && row.base_url.trim()) next.base_url = row.base_url.trim();
        if (typeof row.model === "string" && row.model.trim()) next.model = row.model.trim();
        if (typeof row.auth_header === "string" && row.auth_header.trim()) next.auth_header = row.auth_header.trim();

        // api_key: optional; empty means unchanged.
        if (typeof row.api_key === "string" && row.api_key.trim()) next.api_key = row.api_key.trim();

        out.push(next);
      }

      patch.inference = { ...(patch.inference ?? {}), openai_compat: { profiles: out } };
    }

    if (body.inference?.anthropic?.profiles) {
      const raw = body.inference.anthropic.profiles;
      const out: any[] = [];
      const seen = new Set<string>();

      for (const row of raw) {
        const id = String(row?.id ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const next: any = { id };
        if (typeof row.name === "string" && row.name.trim()) next.name = row.name.trim();
        if (typeof row.base_url === "string" && row.base_url.trim()) next.base_url = row.base_url.trim();
        if (typeof row.model === "string" && row.model.trim()) next.model = row.model.trim();
        if (typeof row.auth_header === "string" && row.auth_header.trim()) next.auth_header = row.auth_header.trim();
        if (typeof row.anthropic_version === "string" && row.anthropic_version.trim()) next.anthropic_version = row.anthropic_version.trim();

        // api_key: optional; empty means unchanged.
        if (typeof row.api_key === "string" && row.api_key.trim()) next.api_key = row.api_key.trim();

        out.push(next);
      }

      patch.inference = { ...(patch.inference ?? {}), anthropic: { profiles: out } };
    }

    if (body.inference?.codex_oauth?.profiles) {
      const raw = body.inference.codex_oauth.profiles;
      const out: any[] = [];

      // Only allow a single profile (Codex auth is global).
      const row = Array.isArray(raw) ? raw[0] : null;
      if (row) {
        const next: any = { id: DEFAULT_PROFILE_ID };
        if (typeof row.name === "string" && row.name.trim()) next.name = row.name.trim();
        if (typeof row.model === "string" && row.model.trim()) next.model = row.model.trim();
        out.push(next);
      }

      patch.inference = { ...(patch.inference ?? {}), codex_oauth: { profiles: out } };
    }
    if (body.adapters?.discord) {
      const d = body.adapters.discord;

      const discord: Partial<{
        enabled: boolean;
        app_id?: string;
        bot_token?: string;
        guild_ids?: string[];
        user_whitelist?: string[];
        force_global_commands?: boolean;
        default_stream_mode?: "full" | "final";
      }> = {};

      if (typeof d.enabled === "boolean") discord.enabled = d.enabled;
      if (typeof d.app_id === "string") discord.app_id = d.app_id;
      if (typeof d.bot_token === "string") discord.bot_token = d.bot_token;
      if (Array.isArray(d.guild_ids)) discord.guild_ids = d.guild_ids;
      if (Array.isArray((d as any).user_whitelist)) discord.user_whitelist = (d as any).user_whitelist;
      if (typeof (d as any).force_global_commands === "boolean") discord.force_global_commands = Boolean((d as any).force_global_commands);

      // adapters.discord.default_stream_mode: validate and normalize.
      if (typeof d.default_stream_mode === "string") {
        const raw = d.default_stream_mode.trim();
        if (raw) {
          if (raw === "full" || raw === "final") discord.default_stream_mode = raw;
          else {
            return json(res, 400, {
              ok: false,
              error: "bad_request",
              hint: "adapters.discord.default_stream_mode must be 'full' or 'final'."
            });
          }
        }
      }

      patch.adapters = { ...(patch.adapters ?? {}), discord };
    }

    if ((body.adapters as any)?.telegram) {
      const t = (body.adapters as any).telegram;

      const telegram: Partial<{
        enabled: boolean;
        bot_token?: string;
        user_whitelist?: string[];
        group_whitelist?: string[];
      }> = {};

      if (typeof t.enabled === "boolean") telegram.enabled = t.enabled;
      if (typeof t.bot_token === "string") telegram.bot_token = t.bot_token;
      if (Array.isArray(t.user_whitelist)) telegram.user_whitelist = t.user_whitelist;
      if (Array.isArray(t.group_whitelist)) telegram.group_whitelist = t.group_whitelist;

      patch.adapters = { ...(patch.adapters ?? {}), telegram };
    }

    if (body.tools?.web) {
      const w = body.tools.web;
      const web: any = {};

      if (typeof w.active_profile === "string") {
        const ap = w.active_profile.trim();
        if (ap) web.active_profile = ap;
      }

      if (Array.isArray(w.profiles)) {
        const raw = w.profiles;
        const out: any[] = [];
        const seen = new Set<string>();

        for (const row of raw) {
          const id = String(row?.id ?? "").trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);

          const rawProvider = typeof row.provider === "string" ? row.provider.trim() : "";
          const provider = rawProvider || DEFAULT_WEB_PROVIDER;
          if (!isWebProviderId(provider)) {
            return json(res, 400, {
              ok: false,
              error: "bad_request",
              hint: `tools.web.profiles[].provider must be '${DEFAULT_WEB_PROVIDER}' (only provider supported for now).`
            });
          }

          const next: any = { id, provider };
          if (typeof row.name === "string" && row.name.trim()) next.name = row.name.trim();
          if (typeof row.project_id === "string") next.project_id = row.project_id.trim();

          // api_key: optional; empty means unchanged.
          if (typeof row.api_key === "string" && row.api_key.trim()) next.api_key = row.api_key.trim();

          out.push(next);
        }

        if (out.length === 0) {
          return json(res, 400, { ok: false, error: "bad_request", hint: "tools.web.profiles must contain at least one profile." });
        }

        // If the client provided an active_profile, ensure it exists in the profile list.
        if (typeof web.active_profile === "string" && !out.some((p) => p.id === web.active_profile)) {
          return json(res, 400, {
            ok: false,
            error: "bad_request",
            hint: "tools.web.active_profile must match an entry in tools.web.profiles[].id."
          });
        }

        web.profiles = out;
      }

      (patch as any).tools = { web };
    }

    if ((body as any)?.plugins?.listener?.email) {
      const e = (body as any).plugins.listener.email;
      const email: any = {};

      if (typeof e.enabled === "boolean") email.enabled = e.enabled;
      if (typeof e.triage_prompt === "string") email.triage_prompt = e.triage_prompt;

      if (Array.isArray(e.accounts)) {
        const raw = e.accounts as any[];
        const out: any[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < raw.length; i++) {
          const row = raw[i];
          const id = String(row?.id ?? "").trim();
          if (!id) {
            return json(res, 400, {
              ok: false,
              error: "bad_request",
              hint: `plugins.listener.email.accounts[${i}].id is required.`
            });
          }
          if (seen.has(id)) {
            return json(res, 400, {
              ok: false,
              error: "bad_request",
              hint: `plugins.listener.email.accounts[].id must be unique (duplicate: '${id}').`
            });
          }
          seen.add(id);

          const host = typeof row?.host === "string" ? row.host.trim() : "";
          const user = typeof row?.user === "string" ? row.user.trim() : "";
          if (!host || !user) {
            return json(res, 400, {
              ok: false,
              error: "bad_request",
              hint: `plugins.listener.email.accounts[${i}] must include host and user.`
            });
          }

          const port = Number(row?.port ?? 993);
          const portNum = Number.isFinite(port) ? Math.trunc(port) : 993;
          if (portNum < 1 || portNum > 65535) {
            return json(res, 400, {
              ok: false,
              error: "bad_request",
              hint: `plugins.listener.email.accounts[${i}].port must be in [1, 65535].`
            });
          }

          const secure = typeof row?.secure === "boolean" ? row.secure : true;

          const mailbox = typeof row?.mailbox === "string" && row.mailbox.trim() ? row.mailbox.trim() : undefined;
          const criterion = typeof row?.criterion === "string" ? row.criterion : "";
          const model = typeof row?.model === "string" && row.model.trim() ? row.model.trim() : undefined;

          const start_from = "now";

          const max_body_chars =
            typeof row?.max_body_chars === "number" && Number.isFinite(row.max_body_chars) ? Math.max(0, Math.trunc(row.max_body_chars)) : undefined;

          const notifyKind = typeof row?.notify?.kind === "string" ? row.notify.kind.trim().toLowerCase() : "";
          let notify: any = null;
          if (notifyKind === "discord") {
            const channel_id = typeof row?.notify?.channel_id === "string" ? row.notify.channel_id.trim() : "";
            if (channel_id) notify = { kind: "discord", channel_id };
          } else if (notifyKind === "telegram") {
            const chat_id = typeof row?.notify?.chat_id === "string" ? row.notify.chat_id.trim() : "";
            if (chat_id) notify = { kind: "telegram", chat_id };
          }

          if (!notify) {
            return json(res, 400, {
              ok: false,
              error: "bad_request",
              hint: `plugins.listener.email.accounts[${i}].notify must be configured (discord.channel_id or telegram.chat_id).`
            });
          }

          const next: any = { id, host, port: portNum, secure, user, criterion, notify, start_from };
          if (typeof row?.pass === "string" && row.pass.trim()) next.pass = row.pass.trim();
          if (mailbox) next.mailbox = mailbox;
          if (model) next.model = model;
          if (typeof max_body_chars === "number") next.max_body_chars = max_body_chars;

          out.push(next);
        }

        email.accounts = out;
      }

      patch.plugins = { ...(patch.plugins ?? {}), listener: { ...((patch.plugins as any)?.listener ?? {}), email } };

      const nextEnabled =
        typeof (email as any).enabled === "boolean" ? (email as any).enabled : Boolean((config as any)?.plugins?.listener?.email?.enabled ?? false);
      const nextAccounts = Array.isArray((email as any).accounts)
        ? ((email as any).accounts as any[])
        : Array.isArray((config as any)?.plugins?.listener?.email?.accounts)
          ? (((config as any).plugins.listener.email.accounts as any[]) ?? [])
          : [];

      if (nextEnabled && nextAccounts.length === 0) {
        return json(res, 400, {
          ok: false,
          error: "bad_request",
          hint: "plugins.listener.email.enabled=true requires at least one account under plugins.listener.email.accounts."
        });
      }
    }

    // Optional: if user sends bot_token="", treat as "do not change".
    if (patch.adapters?.discord && typeof patch.adapters.discord.bot_token === "string") {
      if (!patch.adapters.discord.bot_token.trim()) delete patch.adapters.discord.bot_token;
    }

    // Optional: if user sends telegram bot_token="", treat as "do not change".
    if ((patch.adapters as any)?.telegram && typeof (patch.adapters as any).telegram.bot_token === "string") {
      if (!(patch.adapters as any).telegram.bot_token.trim()) delete (patch.adapters as any).telegram.bot_token;
    }

    // Optional: if user sends plugins.listener.email.accounts[].pass="", treat as "do not change".
    if ((patch as any)?.plugins?.listener?.email && Array.isArray((patch as any).plugins.listener.email.accounts)) {
      for (const acc of (patch as any).plugins.listener.email.accounts as any[]) {
        if (!acc || typeof acc !== "object") continue;
        if (typeof (acc as any).pass === "string" && !(acc as any).pass.trim()) delete (acc as any).pass;
      }
    }

    // Optional: if user sends app_id="", treat as "do not change".
    if (patch.adapters?.discord && typeof patch.adapters.discord.app_id === "string") {
      if (!patch.adapters.discord.app_id.trim()) delete patch.adapters.discord.app_id;
    }

    // Optional: normalize guild_ids (trim, drop empties, de-dup). Empty list means "no guilds".
    if (patch.adapters?.discord && Array.isArray((patch.adapters.discord as any).guild_ids)) {
      const raw = (patch.adapters.discord as any).guild_ids as any[];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of raw) {
        const s = typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "";
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      (patch.adapters.discord as any).guild_ids = out;
    }

    // Optional: normalize user_whitelist (trim, drop empties, de-dup). Empty list means "allow nobody".
    if (patch.adapters?.discord && Array.isArray((patch.adapters.discord as any).user_whitelist)) {
      const raw = (patch.adapters.discord as any).user_whitelist as any[];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of raw) {
        const s = typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "";
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      (patch.adapters.discord as any).user_whitelist = out;
    }

    // Optional: normalize adapters.telegram.user_whitelist (trim, drop empties, de-dup). Empty list means "allow nobody".
    if ((patch.adapters as any)?.telegram && Array.isArray((patch.adapters as any).telegram.user_whitelist)) {
      const raw = (patch.adapters as any).telegram.user_whitelist as any[];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of raw) {
        const s = typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "";
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      (patch.adapters as any).telegram.user_whitelist = out;
    }

    // Optional: normalize adapters.telegram.group_whitelist (trim, drop empties, de-dup).
    if ((patch.adapters as any)?.telegram && Array.isArray((patch.adapters as any).telegram.group_whitelist)) {
      const raw = (patch.adapters as any).telegram.group_whitelist as any[];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of raw) {
        const s = typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "";
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      (patch.adapters as any).telegram.group_whitelist = out;
    }

    // Preflight host/port bind if console is being changed (avoid writing broken config).
    if (patch.console?.host || patch.console?.port) {
      const host = String(patch.console?.host ?? config.console.host);
      const port = Number(patch.console?.port ?? config.console.port);
      const ok = await preflightListen(host, port);
      if (!ok.ok) return json(res, 400, ok);
    }

    try {
      writeLocalEcliaConfig(patch, rootDir);
      return json(res, 200, { ok: true, restartRequired: true });
    } catch {
      return json(res, 500, { ok: false, error: "write_failed", hint: "Failed to write eclia.config.local.toml." });
    }
  }

  json(res, 405, { ok: false, error: "method_not_allowed" });
}
