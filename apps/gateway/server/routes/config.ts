import http from "node:http";

import { loadEcliaConfig, preflightListen, type EcliaConfigPatch, writeLocalEcliaConfig } from "@eclia/config";

import { json, readJson } from "../httpUtils.js";

type ConfigReqBody = {
  console?: { host?: string; port?: number };
  api?: { port?: number };
  inference?: {
    openai_compat?: {
      base_url?: string;
      model?: string;
      api_key?: string;
      auth_header?: string;
    };
  };
  adapters?: {
    discord?: {
      enabled?: boolean;
      app_id?: string; // non-secret (optional; empty means unchanged)
      bot_token?: string; // secret (optional; empty means unchanged)
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
            base_url: config.inference.openai_compat.base_url,
            model: config.inference.openai_compat.model,
            api_key_configured: Boolean(config.inference.openai_compat.api_key && config.inference.openai_compat.api_key.trim())
          }
        },
        adapters: {
          discord: {
            enabled: Boolean(config.adapters.discord.enabled),
            app_id: String(config.adapters.discord.app_id ?? ""),
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
    if (body.inference?.openai_compat) patch.inference = { openai_compat: body.inference.openai_compat };
    if (body.adapters?.discord) patch.adapters = { discord: body.adapters.discord };

    // Optional: if user sends api_key="", treat as "do not change".
    if (patch.inference?.openai_compat && typeof patch.inference.openai_compat.api_key === "string") {
      if (!patch.inference.openai_compat.api_key.trim()) delete patch.inference.openai_compat.api_key;
    }

    // Optional: if user sends bot_token="", treat as "do not change".
    if (patch.adapters?.discord && typeof patch.adapters.discord.bot_token === "string") {
      if (!patch.adapters.discord.bot_token.trim()) delete patch.adapters.discord.bot_token;
    }

    // Optional: if user sends app_id="", treat as "do not change".
    if (patch.adapters?.discord && typeof patch.adapters.discord.app_id === "string") {
      if (!patch.adapters.discord.app_id.trim()) delete patch.adapters.discord.app_id;
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
