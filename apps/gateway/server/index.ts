import http from "node:http";
import path from "node:path";
import * as fs from "node:fs";
import crypto from "node:crypto";

import { loadEcliaConfig } from "@eclia/config";

import { SessionStore } from "./sessionStore.js";
import { ToolApprovalHub } from "./tools/approvalHub.js";
import { EXEC_TOOL_NAME, SEND_TOOL_NAME } from "./tools/toolSchemas.js";
import { SEND_TOOL_SCHEMA } from "./tools/sendTool.js";
import { McpStdioClient, type McpToolDef } from "./mcp/stdioClient.js";
import { json } from "./httpUtils.js";

import { handleArtifacts } from "./routes/artifacts.js";
import { handleChat } from "./routes/chat.js";
import { handleConfig } from "./routes/config.js";
import { handleCodexOAuth, handleCodexOAuthClear, handleCodexOAuthStatus } from "./routes/codexOAuth.js";
import { handlePickFolder } from "./routes/nativeDialog.js";
import { handleSessions } from "./routes/sessions.js";
import { handleToolApprovals } from "./routes/toolApprovals.js";

const ARTIFACT_SESSION_COOKIE = "ECLIA_ARTIFACT_SESSION";
// Local-only hardening: artifact session cookie is a browser convenience to
// allow <img src> / <a href> loads without embedding the gateway token in URLs.
// This cookie is scoped to /api/artifacts and is never used to authorize other
// API routes.
const ARTIFACT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const artifactSessions = new Map<string, number>(); // sessionId -> expiresAt

async function main() {
  const { config, rootDir } = loadEcliaConfig(process.cwd());
  const port = config.api.port;

  // ---------------------------------------------------------------------------
  // Codex state isolation
  //
  // By default, Codex CLI stores local state under CODEX_HOME (defaults to ~/.codex).
  // ECLIA spawns `codex app-server` frequently, and we want to avoid polluting a user
  // machine's global Codex state (and to make it easy to reset/debug).
  //
  // We therefore default CODEX_HOME to <repo>/.codex unless the user explicitly sets
  // CODEX_HOME or ECLIA_CODEX_HOME.
  // ---------------------------------------------------------------------------
  const codexHomeOverride = (process.env.ECLIA_CODEX_HOME ?? config.codex_home)?.trim();
  const defaultCodexHome = path.join(rootDir, ".codex");
  const codexHome = codexHomeOverride && codexHomeOverride.length ? codexHomeOverride : (process.env.CODEX_HOME?.trim() || defaultCodexHome);
  // Override CODEX_HOME when explicitly requested (env or config). Otherwise keep existing CODEX_HOME.
  if (!process.env.CODEX_HOME || (codexHomeOverride && codexHomeOverride.length)) process.env.CODEX_HOME = codexHome;
  try {
    fs.mkdirSync(codexHome, { recursive: true });
  } catch (e) {
    console.warn(`[gateway] warning: failed to create CODEX_HOME at ${codexHome}:`, e);
  }

  // MCP exec toolhost (stdio) ------------------------------------------------

  const toolhostApp = process.platform === "win32" ? "toolhost-exec-win32" : "toolhost-exec-posix";
  const toolhostEntry = path.join(rootDir, "apps", toolhostApp, "server", "index.js");
  const mcpExec = await McpStdioClient.spawn({
    command: process.execPath,
    argv: [toolhostEntry],
    cwd: rootDir,
    env: process.env,
    label: toolhostApp
  });

  // Discover tools (MCP tools/list) and adapt them to upstream OpenAI tool schema.
  const mcpTools = await mcpExec.listTools();
  const execTool = mcpTools.find((t) => t && t.name === "exec");
  if (!execTool) {
    console.error(`[gateway] fatal: toolhost did not expose required tool: exec`);
    process.exit(1);
  }

  const parameters = (execTool as McpToolDef).inputSchema ?? { type: "object" };

  const toolsForModel = [
    {
      type: "function",
      function: {
        name: EXEC_TOOL_NAME,
        description:
          execTool.description ||
          "Execute a shell command on the local machine. Provide a command string in 'command'. Returns stdout/stderr/exitCode.",
        parameters
      }
    },
    {
      type: "function",
      function: {
        name: SEND_TOOL_NAME,
        description:
          "Send text and/or artifacts to the request origin (web/discord) or an explicitly specified destination. " +
          "Artifact refs (from exec results) are always allowed. In safe mode, sending local files by absolute path or manually specifying a destination requires user approval.",
        parameters: SEND_TOOL_SCHEMA
      }
    }
  ];

  const toolhost = {
    mcp: mcpExec,
    toolsForModel,
    nameToMcpTool: (name: string) => name
  };

  // Session store lives under <repo>/.eclia by default.
  const dataDir = path.join(rootDir, ".eclia");

  // ---------------------------------------------------------------------------
  // Gateway internal auth token
  //
  // Dev-time hardening: require an internal bearer token for all API routes
  // (except /api/health). The token is stored on disk under <repo>/.eclia/
  // with restrictive permissions.
  // ---------------------------------------------------------------------------
  const tokenPath = path.join(dataDir, "gateway.token");
  const tokenInfo = ensureGatewayToken(tokenPath);
  if (tokenInfo.created) {
    console.log(`[gateway] generated auth token (stored at ${tokenPath}):`);
    console.log(tokenInfo.token);
  }
  const gatewayToken = tokenInfo.token;

  const store = new SessionStore(dataDir);
  await store.init();

  // In-memory hub for interactive tool approvals.
  const approvals = new ToolApprovalHub();

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";

    const u = new URL(url, "http://localhost");
    const pathname = u.pathname;

    if (pathname === "/api/health" && req.method === "GET") return json(res, 200, { ok: true });

    // Internal auth: all API routes require a bearer token.
    // Exception: /api/artifacts can also be accessed with a scoped, HttpOnly
    // browser cookie session (only used for artifacts).
    if (pathname.startsWith("/api/")) {
      const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : "";

      let ok = false;
      if (pathname === "/api/artifacts") {
        const cookieHeader = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
        const cookies = parseCookieHeader(cookieHeader);
        const sid = (cookies[ARTIFACT_SESSION_COOKIE] ?? "").trim();
        ok = isValidBearer(auth, gatewayToken) || isValidArtifactSession(sid);
      } else {
        ok = isValidBearer(auth, gatewayToken);
      }

      if (!ok) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="eclia"');
        return json(res, 401, {
          ok: false,
          error: "unauthorized",
          hint:
            "Missing or invalid gateway token. Configure the Web Console with the token printed by the gateway, " +
            "or send: Authorization: Bearer <token>."
        });
      }
    }

    // Exchange the internal bearer token for a browser-scoped artifacts session.
    // This keeps the gateway token out of <img src> URLs while preserving the
    // existing token-based API auth for programmatic clients.
    if (pathname === "/api/auth/artifacts-session" && req.method === "POST") {
      const cookieHeader = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
      const cookies = parseCookieHeader(cookieHeader);
      const existing = (cookies[ARTIFACT_SESSION_COOKIE] ?? "").trim();

      const { id, created, expiresAt } = createOrRefreshArtifactSession(existing);

      const secure = isHttpsRequest(req);
      const maxAgeSeconds = Math.floor(ARTIFACT_SESSION_TTL_MS / 1000);
      res.setHeader(
        "Set-Cookie",
        serializeCookie(ARTIFACT_SESSION_COOKIE, id, {
          httpOnly: true,
          sameSite: "Strict",
          path: "/api/artifacts",
          maxAge: maxAgeSeconds,
          secure
        })
      );
      res.setHeader("Cache-Control", "no-store");
      return json(res, 200, { ok: true, created, expiresAt });
    }

    if (pathname === "/api/config") return await handleConfig(req, res);

    if (pathname === "/api/codex/oauth/start" && req.method === "POST") return await handleCodexOAuth(req, res);

    if (pathname === "/api/codex/oauth/clear" && req.method === "POST") return await handleCodexOAuthClear(req, res);

    if (pathname === "/api/codex/oauth/status" && req.method === "GET") return await handleCodexOAuthStatus(req, res);

    if (pathname === "/api/native/pick-folder") return await handlePickFolder(req, res);

    if (pathname === "/api/artifacts") return await handleArtifacts(req, res, rootDir);

    if (pathname.startsWith("/api/sessions")) return await handleSessions(req, res, store);

    if (pathname === "/api/tool-approvals") return await handleToolApprovals(req, res, approvals);

    if (pathname === "/api/chat" && req.method === "POST") return await handleChat(req, res, store, approvals, toolhost);

    json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[gateway] listening on http://localhost:${port}`);
    console.log(`[gateway] POST http://localhost:${port}/api/chat`);
    console.log(`[gateway] POST http://localhost:${port}/api/tool-approvals`);
    console.log(`[gateway] GET/PUT http://localhost:${port}/api/config`);
    console.log(`[gateway] GET/POST http://localhost:${port}/api/sessions`);
  });
}

function ensureGatewayToken(tokenPath: string): { token: string; created: boolean } {
  try {
    const existing = fs.readFileSync(tokenPath, "utf-8").trim();
    if (existing) {
      // Best-effort hardening: ensure owner-only perms on POSIX.
      try {
        fs.chmodSync(tokenPath, 0o600);
      } catch {
        // ignore
      }
      return { token: existing, created: false };
    }
  } catch {
    // fallthrough
  }

  const dir = path.dirname(tokenPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort; subsequent write will surface the error
  }

  const token = crypto.randomBytes(32).toString("hex");

  try {
    // Create with restrictive perms; mode only applies on creation.
    fs.writeFileSync(tokenPath, token + "\n", { encoding: "utf-8", flag: "wx", mode: 0o600 });
    return { token, created: true };
  } catch (e: any) {
    // Race: if another process created it, read it.
    if (String(e?.code ?? "") === "EEXIST") {
      const existing = fs.readFileSync(tokenPath, "utf-8").trim();
      if (existing) {
        try {
          fs.chmodSync(tokenPath, 0o600);
        } catch {
          // ignore
        }
        return { token: existing, created: false };
      }
    }
    throw e;
  }
}

function isValidBearer(authHeader: string, expectedToken: string): boolean {
  const raw = (authHeader ?? "").trim();
  if (!raw) return false;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const got = (m[1] ?? "").trim();
  if (!got) return false;
  return got === expectedToken;
}

function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = (header ?? "").trim();
  if (!raw) return out;
  const parts = raw.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx <= 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

function isValidArtifactSession(sessionId: string): boolean {
  const sid = (sessionId ?? "").trim();
  if (!sid) return false;
  const exp = artifactSessions.get(sid);
  if (!exp) return false;
  const now = Date.now();
  if (exp <= now) {
    artifactSessions.delete(sid);
    return false;
  }
  return true;
}

function createOrRefreshArtifactSession(existingId: string): { id: string; created: boolean; expiresAt: number } {
  const now = Date.now();

  // Opportunistic pruning (keep memory bounded).
  if (artifactSessions.size > 1024) {
    for (const [id, exp] of artifactSessions) {
      if (exp <= now) artifactSessions.delete(id);
    }
  }

  const existing = (existingId ?? "").trim();
  if (existing && isValidArtifactSession(existing)) {
    const expiresAt = now + ARTIFACT_SESSION_TTL_MS;
    artifactSessions.set(existing, expiresAt);
    return { id: existing, created: false, expiresAt };
  }

  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = now + ARTIFACT_SESSION_TTL_MS;
  artifactSessions.set(id, expiresAt);
  return { id, created: true, expiresAt };
}

function isHttpsRequest(req: http.IncomingMessage): boolean {
  // Direct TLS server
  if ((req.socket as any)?.encrypted) return true;

  // Reverse proxies typically set this.
  const xf = req.headers["x-forwarded-proto"];
  const proto = typeof xf === "string" ? xf : Array.isArray(xf) ? xf[0] : "";
  if (proto) return proto.split(",")[0].trim().toLowerCase() === "https";
  return false;
}

function serializeCookie(
  name: string,
  value: string,
  opts: { httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None"; path?: string; maxAge?: number }
): string {
  // Minimal, standards-friendly serialization.
  let s = `${name}=${value}`;
  if (opts.maxAge && Number.isFinite(opts.maxAge)) s += `; Max-Age=${Math.max(0, Math.trunc(opts.maxAge))}`;
  if (opts.path) s += `; Path=${opts.path}`;
  if (opts.httpOnly) s += `; HttpOnly`;
  if (opts.secure) s += `; Secure`;
  if (opts.sameSite) s += `; SameSite=${opts.sameSite}`;
  return s;
}

main().catch((e) => {
  console.error("[gateway] fatal:", e);
  process.exit(1);
});
