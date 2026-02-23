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
    if (pathname.startsWith("/api/")) {
      const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
      const tokenFromQuery = pathname === "/api/artifacts" ? (u.searchParams.get("token") ?? "") : "";
      const ok = isValidBearer(auth, gatewayToken) || (tokenFromQuery && tokenFromQuery === gatewayToken);

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

main().catch((e) => {
  console.error("[gateway] fatal:", e);
  process.exit(1);
});
