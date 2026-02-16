import http from "node:http";

import { loadEcliaConfig, preflightListen, type EcliaConfigPatch, writeLocalEcliaConfig } from "@eclia/config";

import { json, readJson } from "../httpUtils.js";

type ConfigReqBody = {
  codex_home?: string;
  console?: { host?: string; port?: number };
  api?: { port?: number };
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
};

export async function handleConfig(req: http.IncomingMessage, res: http.ServerResponse) {
  const { config, rootDir } = loadEcliaConfig(process.cwd());

  if (req.method === "GET") {
    // Do NOT return secrets.
    return json(res, 200, {
      ok: true,
      config: {
        codex_home: config.codex_home,
        console: config.console,
        api: config.api,
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
