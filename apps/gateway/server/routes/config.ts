import http from "node:http";

import { loadEcliaConfig, preflightListen, type EcliaConfigPatch, writeLocalEcliaConfig } from "@eclia/config";

import { discoverSkills, validateEnabledSkills } from "../skills/registry.js";

import { json, readJson } from "../httpUtils.js";

type ConfigReqBody = {
  codex_home?: string;
  console?: { host?: string; port?: number };
  api?: { port?: number };
  debug?: {
    capture_upstream_requests?: boolean;
    parse_assistant_output?: boolean;
  };
  skills?: {
    enabled?: string[];
  };
  inference?: {
    system_instruction?: string;
    openai_compat?: {
      profiles?: Array<{
        id: string;
        name?: string;
        base_url?: string;
        model?: string;
        api_key?: string;
        auth_header?: string;
      }>;
    };

    codex_oauth?: {
      profiles?: Array<{
        id: string;
        name?: string;
        model?: string;
      }>;
    };
  };
  adapters?: {
    discord?: {
      enabled?: boolean;
      app_id?: string; // non-secret (optional; empty means unchanged)
      bot_token?: string; // secret (optional; empty means unchanged)
      guild_ids?: string[]; // non-secret (optional)
      default_stream_mode?: string; // non-secret (optional): "full" | "final"
    };
  };

  tools?: {
    web?: {
      active_profile?: string;
      profiles?: Array<{
        id: string;
        name?: string;
        provider?: string;
        api_key?: string;
        project_id?: string;
      }>;
    };
  };
};

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
      const provider = typeof row?.provider === "string" && row.provider.trim() ? row.provider.trim() : "tavily";
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
        id: "default",
        name: "Default",
        provider: "tavily",
        project_id: legacyTavilyProject,
        api_key_configured: Boolean(legacyTavilyKey)
      });
    }

    let toolsWebActiveProfile = typeof toolsWeb.active_profile === "string" ? toolsWeb.active_profile.trim() : "";
    if (!toolsWebProfiles.some((p) => p.id === toolsWebActiveProfile)) {
      toolsWebActiveProfile = toolsWebProfiles[0]?.id ?? "default";
    }

    // If a legacy Tavily key is present but profiles are configured without api_key, treat the
    // active profile as "configured" for UX (the runtime resolver will fall back to legacy paths).
    if (legacyTavilyKey) {
      const active = toolsWebProfiles.find((p) => p.id === toolsWebActiveProfile);
      if (active && active.provider === "tavily" && !active.api_key_configured) {
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
            default_stream_mode: config.adapters.discord.default_stream_mode,
            app_id_configured: Boolean(config.adapters.discord.app_id && config.adapters.discord.app_id.trim()),
            bot_token_configured: Boolean(config.adapters.discord.bot_token && config.adapters.discord.bot_token.trim())
          }
        },
        tools: {
          web: {
            active_profile: toolsWebActiveProfile,
            profiles: toolsWebProfiles
          }
        }
      }
    });
  }

  if (req.method === "PUT") {
    const body = (await readJson(req)) as ConfigReqBody;

    const patch: EcliaConfigPatch = {};

    if (typeof body.codex_home === "string") {
      // Empty string means "unset" (use default).
      patch.codex_home = body.codex_home.trim();
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

    if (body.inference?.codex_oauth?.profiles) {
      const raw = body.inference.codex_oauth.profiles;
      const out: any[] = [];

      // Only allow a single profile (Codex auth is global).
      const row = Array.isArray(raw) ? raw[0] : null;
      if (row) {
        const next: any = { id: "default" };
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
        default_stream_mode?: "full" | "final";
      }> = {};

      if (typeof d.enabled === "boolean") discord.enabled = d.enabled;
      if (typeof d.app_id === "string") discord.app_id = d.app_id;
      if (typeof d.bot_token === "string") discord.bot_token = d.bot_token;
      if (Array.isArray(d.guild_ids)) discord.guild_ids = d.guild_ids;

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

      patch.adapters = { discord };
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

          const provider = typeof row.provider === "string" && row.provider.trim() ? row.provider.trim() : "tavily";
          if (provider !== "tavily") {
            return json(res, 400, {
              ok: false,
              error: "bad_request",
              hint: "tools.web.profiles[].provider must be 'tavily' (only provider supported for now)."
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

    // Optional: if user sends bot_token="", treat as "do not change".
    if (patch.adapters?.discord && typeof patch.adapters.discord.bot_token === "string") {
      if (!patch.adapters.discord.bot_token.trim()) delete patch.adapters.discord.bot_token;
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
