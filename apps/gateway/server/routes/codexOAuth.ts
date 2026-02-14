import http from "node:http";

import {
  loadEcliaConfig,
  writeLocalEcliaConfig,
  type CodexOAuthProfile,
  type EcliaConfigPatch
} from "@eclia/config";

import { json, readJson } from "../httpUtils.js";
import { spawnCodexAppServerRpc } from "../upstream/codexAppServerRpc.js";
import { formatCodexError } from "../upstream/codexErrors.js";

type CodexOAuthStartReqBody = {
  profile?: {
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

type CodexOAuthStatusResponse =
  | {
      ok: true;
      requires_openai_auth: boolean;
      account: null | {
        type: string;
        email?: string;
        planType?: string;
      };
      models: string[] | null;
    }
  | {
      ok: false;
      error: string;
      hint?: string;
    };

type CodexOAuthClearResponse =
  | { ok: true; hint?: string }
  | {
      ok: false;
      error: string;
      hint?: string;
    };

const DEFAULT_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "Default";
const DEFAULT_MODEL = "gpt-5.2-codex";

// Keep the Codex app-server process alive during the browser login flow,
// because it hosts the local callback server and persists tokens on completion.
//
// NOTE: Codex ChatGPT auth is global (stored by the Codex CLI), so we only
// support a single OAuth profile in ECLIA to avoid confusing UX.
let activeLogin:
  | {
      rpc: ReturnType<typeof spawnCodexAppServerRpc>;
      loginId: string;
      startedAt: number;
    }
  | null = null;

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

  const { rootDir } = loadEcliaConfig(process.cwd());

  const body = (await readJson(req)) as CodexOAuthStartReqBody;
  const profileId = DEFAULT_PROFILE_ID;
  const name = String(body?.profile?.name ?? "").trim() || DEFAULT_PROFILE_NAME;
  const model = String(body?.profile?.model ?? "").trim() || DEFAULT_MODEL;

  // Prevent launching multiple app-server login processes.
  if (activeLogin) {
    return json(res, 409, {
      ok: false,
      error: "login_in_progress",
      hint: "A browser login flow is already running. Finish it (or wait for timeout) before starting again."
    } satisfies CodexOAuthStartResponse);
  }

  // Ensure exactly one profile exists in local.toml.
  // We intentionally do NOT persist ChatGPT tokens in local.toml in this mode.
  const next: CodexOAuthProfile[] = [{ id: profileId, name, model }];

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

    activeLogin = { rpc, loginId: picked.loginId, startedAt: Date.now() };

    // Best-effort: watch completion, then clean up.
    void rpc
      .waitForNotification("account/login/completed", (p) => p?.loginId === picked.loginId, 10 * 60_000)
      .catch(() => null)
      .finally(() => {
        activeLogin = null;
        rpc.close();
      });

    return json(res, 200, { ok: true, url: picked.authUrl, login_id: picked.loginId } satisfies CodexOAuthStartResponse);
  } catch (e) {
    rpc.close();
    const msg = formatCodexError(e);
    return json(res, 502, { ok: false, error: "codex_login_failed", hint: msg } satisfies CodexOAuthStartResponse);
  }
}

export async function handleCodexOAuthClear(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method_not_allowed" } satisfies CodexOAuthClearResponse);
  }

  const { rootDir } = loadEcliaConfig(process.cwd());

  // Stop any in-flight login flow.
  if (activeLogin) {
    try {
      activeLogin.rpc.close();
    } catch {
      // ignore
    }
    activeLogin = null;
  }

  // IMPORTANT: Codex ChatGPT auth is global (stored by the Codex CLI), not per ECLIA profile.
  // "Clear config" should therefore sign out from Codex itself, otherwise the status check
  // will keep showing "Ready" even after resetting local.toml.
  {
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

      // Docs: `account/logout` signs out and triggers account/updated authMode: null.
      // We verify the effect so the UI status changes immediately after a successful clear.
      const before = await rpc.request("account/read", { refreshToken: false });
      const beforeType = typeof before?.account?.type === "string" ? String(before.account.type) : "";
      if (beforeType) {
        await rpc.request("account/logout");
        const after = await rpc.request("account/read", { refreshToken: false });
        const afterType = typeof after?.account?.type === "string" ? String(after.account.type) : "";
        if (afterType) {
          throw new Error("Codex logout did not clear the active credentials.");
        }
      }
    } catch (e) {
      const msg = formatCodexError(e);
      return json(res, 502, {
        ok: false,
        error: "codex_logout_failed",
        hint: msg
      } satisfies CodexOAuthClearResponse);
    } finally {
      rpc.close();
    }
  }

  // Reset to a single default profile.
  const patch: EcliaConfigPatch = {
    inference: {
      codex_oauth: {
        profiles: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, model: DEFAULT_MODEL }]
      }
    }
  };

  try {
    writeLocalEcliaConfig(patch, rootDir);
    return json(res, 200, { ok: true } satisfies CodexOAuthClearResponse);
  } catch {
    return json(res, 500, {
      ok: false,
      error: "write_failed",
      hint: "Failed to write eclia.config.local.toml."
    } satisfies CodexOAuthClearResponse);
  }
}


export async function handleCodexOAuthStatus(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "GET") {
    return json(res, 405, { ok: false, error: "method_not_allowed" } satisfies CodexOAuthStatusResponse);
  }

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

    // Docs: `account/read` returns the current auth state.
    // We do not force a refresh here; this endpoint is intended to be lightweight.
    const acct = await rpc.request("account/read", { refreshToken: false });
    const requiresOpenaiAuth = acct?.requiresOpenaiAuth === true;
    const account = acct?.account && typeof acct.account === "object" ? acct.account : null;

    // Docs: `model/list` returns the available models for the current auth context.
    // We use this to validate per-profile model strings in the UI.
    let models: string[] | null = null;
    try {
      const out = await rpc.request("model/list", { limit: 200 });
      const data = Array.isArray(out?.data) ? (out.data as any[]) : [];
      const ids = data
        .map((m) => String(m?.id ?? m?.model ?? "").trim())
        .filter((s) => !!s);
      models = Array.from(new Set(ids));
    } catch {
      models = null;
    }

    return json(res, 200, {
      ok: true,
      requires_openai_auth: requiresOpenaiAuth,
      account: account
        ? {
            type: String(account?.type ?? ""),
            email: typeof account?.email === "string" ? account.email : undefined,
            planType: typeof account?.planType === "string" ? account.planType : undefined
          }
        : null,
      models
    } satisfies CodexOAuthStatusResponse);
  } catch (e) {
    const msg = formatCodexError(e);
    return json(res, 502, { ok: false, error: "codex_status_failed", hint: msg } satisfies CodexOAuthStatusResponse);
  } finally {
    rpc.close();
  }
}
