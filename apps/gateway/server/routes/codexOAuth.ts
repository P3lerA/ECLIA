import http from "node:http";

import {
  loadEcliaConfig,
  writeLocalEcliaConfig,
  type CodexOAuthProfile,
  type EcliaConfigPatch
} from "@eclia/config";

import { json, readJson } from "../httpUtils.js";
import { spawnCodexAppServerRpc } from "../upstream/codexAppServerRpc.js";

type CodexOAuthStartReqBody = {
  profile?: {
    id?: string;
    name?: string;
    model?: string;
  };
};

type CodexOAuthStartResponse =
  | {
      ok: true;
      url: string;
      login_id: string;
    }
  | {
      ok: false;
      error: string;
      hint?: string;
    };

// Keep the Codex app-server process alive during the browser login flow,
// because it hosts the local callback server and persists tokens on completion.
const activeLogins = new Map<
  string,
  {
    rpc: ReturnType<typeof spawnCodexAppServerRpc>;
    loginId: string;
    startedAt: number;
  }
>();

function pickAuthUrl(res: any): { authUrl: string; loginId: string } | null {
  const authUrl = typeof res?.authUrl === "string" ? res.authUrl.trim() : "";
  const loginId = typeof res?.loginId === "string" ? res.loginId.trim() : "";
  if (!authUrl || !loginId) return null;
  return { authUrl, loginId };
}

export async function handleCodexOAuth(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method_not_allowed" } satisfies CodexOAuthStartResponse);
  }

  const { config, rootDir } = loadEcliaConfig(process.cwd());

  const body = (await readJson(req)) as CodexOAuthStartReqBody;
  const profileId = String(body?.profile?.id ?? "").trim();
  const name = String(body?.profile?.name ?? "").trim() || "Untitled";
  const model = String(body?.profile?.model ?? "").trim();

  if (!profileId) {
    return json(res, 400, { ok: false, error: "invalid_profile", hint: "Missing profile.id" } satisfies CodexOAuthStartResponse);
  }
  if (!model) {
    return json(res, 400, { ok: false, error: "invalid_profile", hint: "Missing profile.model" } satisfies CodexOAuthStartResponse);
  }

  // Prevent launching multiple app-server login processes per profile.
  if (activeLogins.has(profileId)) {
    return json(res, 409, {
      ok: false,
      error: "login_in_progress",
      hint: "A browser login flow is already running for this profile. Finish it (or wait for timeout) before starting again."
    } satisfies CodexOAuthStartResponse);
  }

  // Ensure the profile exists in local.toml so routing (codex-oauth:<id>) is stable.
  // We intentionally do NOT persist ChatGPT tokens in local.toml in this mode.
  const existing = config.inference.codex_oauth?.profiles ?? [];
  const next: CodexOAuthProfile[] = [];
  const seen = new Set<string>();

  for (const p of existing) {
    if (!p || typeof p.id !== "string") continue;
    const id = p.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    if (id === profileId) {
      next.push({
        ...p,
        id: profileId,
        name,
        model
      });
    } else {
      next.push(p);
    }
  }

  if (!seen.has(profileId)) {
    next.push({ id: profileId, name, model });
  }

  const patch: EcliaConfigPatch = {
    inference: {
      codex_oauth: {
        profiles: next
      }
    }
  };

  try {
    writeLocalEcliaConfig(patch, rootDir);
  } catch {
    return json(res, 500, {
      ok: false,
      error: "write_failed",
      hint: "Failed to write eclia.config.local.toml."
    } satisfies CodexOAuthStartResponse);
  }

  // Start Codex-managed ChatGPT login.
  // Docs: account/login/start with type: "chatgpt" returns { loginId, authUrl },
  // and then emits account/login/completed on success/error.
  // We keep the process alive until completion so the local callback can be served.
  const rpc = spawnCodexAppServerRpc();

  try {
    await rpc.request("initialize", {
      clientInfo: {
        name: "eclia_gateway",
        title: "ECLIA Gateway",
        version: "0.0.0"
      }
    });
    rpc.notify("initialized", {});

    const out = await rpc.request("account/login/start", { type: "chatgpt" });
    const picked = pickAuthUrl(out);
    if (!picked) {
      rpc.close();
      return json(res, 502, {
        ok: false,
        error: "codex_invalid_response",
        hint: "Codex app-server did not return authUrl/loginId for ChatGPT login."
      } satisfies CodexOAuthStartResponse);
    }

    activeLogins.set(profileId, { rpc, loginId: picked.loginId, startedAt: Date.now() });

    // Best-effort: watch completion, then clean up.
    void rpc
      .waitForNotification("account/login/completed", (p) => p?.loginId === picked.loginId, 10 * 60_000)
      .catch(() => null)
      .finally(() => {
        activeLogins.delete(profileId);
        rpc.close();
      });

    return json(res, 200, { ok: true, url: picked.authUrl, login_id: picked.loginId } satisfies CodexOAuthStartResponse);
  } catch (e) {
    rpc.close();
    const msg = e instanceof Error ? e.message : String(e ?? "Codex login failed");
    return json(res, 502, { ok: false, error: "codex_login_failed", hint: msg } satisfies CodexOAuthStartResponse);
  }
}
