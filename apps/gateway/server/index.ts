import http from "node:http";
import path from "node:path";
import * as fs from "node:fs";

import { loadEcliaConfig } from "@eclia/config";

import { SessionStore } from "./sessionStore.js";
import { ToolApprovalHub } from "./tools/approvalHub.js";
import { EXEC_TOOL_NAME, EXECUTION_TOOL_NAME, SEND_TOOL_NAME } from "./tools/toolSchemas.js";
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
          "Execute a command on the local machine. Prefer 'cmd'+'args' for safety. Returns stdout/stderr/exitCode.",
        parameters
      }
    },
    {
      type: "function",
      function: {
        name: EXECUTION_TOOL_NAME,
        description: execTool.description || "Alias of 'exec'. Execute a command on the local machine.",
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
    nameToMcpTool: (name: string) => (name === EXECUTION_TOOL_NAME ? EXEC_TOOL_NAME : name)
  };

  // Session store lives under <repo>/.eclia by default.
  const dataDir = path.join(rootDir, ".eclia");
  const store = new SessionStore(dataDir);
  await store.init();

  // In-memory hub for interactive tool approvals.
  const approvals = new ToolApprovalHub();

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";

    // Basic CORS for direct access (Vite proxy usually makes this unnecessary).
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const u = new URL(url, "http://localhost");
    const pathname = u.pathname;

    if (pathname === "/api/health" && req.method === "GET") return json(res, 200, { ok: true });

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

main().catch((e) => {
  console.error("[gateway] fatal:", e);
  process.exit(1);
});
