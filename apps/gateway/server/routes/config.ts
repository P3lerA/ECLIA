import http from "node:http";

import { loadEcliaConfig, preflightListen, type EcliaConfigPatch, writeLocalEcliaConfig } from "@eclia/config";

import { json, readJson } from "../httpUtils.js";

type ConfigReqBody = {
  console?: { host?: string; port?: number };
  api?: { port?: number };
  inference?: {
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
        console: config.console,
        api: config.api,
        inference: {
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
            profiles: (config.inference.codex_oauth?.profiles ?? []).map((p) => ({
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
    if (body.console) patch.console = body.console;
    if (body.api) patch.api = body.api;
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
      const seen = new Set<string>();

      for (const row of raw) {
        const id = String(row?.id ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const next: any = { id };
        if (typeof row.name === "string" && row.name.trim()) next.name = row.name.trim();
        if (typeof row.model === "string" && row.model.trim()) next.model = row.model.trim();
        out.push(next);
      }

      patch.inference = { ...(patch.inference ?? {}), codex_oauth: { profiles: out } };
    }
    if (body.adapters?.discord) patch.adapters = { discord: body.adapters.discord };

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
