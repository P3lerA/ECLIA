import http from "node:http";
import { loadEcliaConfig } from "@eclia/config";
import { json } from "@eclia/gateway-client/utils";
import { now } from "./httpUtils.js";
import { openJsonStore } from "./store/jsonStore.js";
import {
  handleListMemories,
  handleCreateMemory,
  handleUpdateMemory,
  handleDeleteMemory,
  handleGetAllFacts
} from "./handlers/memoryHandlers.js";
import { handleMemoryTool } from "./handlers/memoryToolHandlers.js";
import { createToolSessionLogger } from "./tools/toolSessionLogger.js";

async function start() {
  const { rootDir, config } = loadEcliaConfig(process.cwd());

  const host = String((config as any)?.memory?.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const portRaw = (config as any)?.memory?.port;
  const portNum = typeof portRaw === "number" ? portRaw : typeof portRaw === "string" ? Number(portRaw) : 8788;
  const port = Number.isFinite(portNum) ? Math.trunc(portNum) : 8788;

  const store = await openJsonStore(rootDir);

  const toolLogger = createToolSessionLogger({ rootDir, sessionId: "memory-tool" });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const { pathname } = url;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.end();

    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "memory",
        ts: now(),
        store: { path: store.filePath, facts: store.allFacts().length }
      });
    }

    // Return all facts as plain text (for system prompt injection by gateway).
    if (req.method === "GET" && pathname === "/profile") {
      return handleGetAllFacts(res, { store });
    }

    if (req.method === "POST" && pathname === "/tools/memory") {
      return await handleMemoryTool(req, res, { toolLogger, store });
    }

    if (req.method === "GET" && pathname === "/memories") return await handleListMemories(req, res, { store });

    if (req.method === "POST" && pathname === "/memories") {
      return await handleCreateMemory(req, res, { store });
    }

    if (pathname.startsWith("/memories/") && pathname.length > "/memories/".length) {
      const id = pathname.slice("/memories/".length);
      if (req.method === "PATCH") {
        return await handleUpdateMemory(req, res, id, { store });
      }
      if (req.method === "DELETE") return await handleDeleteMemory(res, id, { store });
    }

    return json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, host, () => {
    console.log(`[memory] listening on http://${host}:${port}`);
    console.log(`[memory] store: ${store.filePath} (${store.allFacts().length} facts)`);
    console.log(`[memory] profile: GET /profile`);
    console.log(`[memory] tool: POST /tools/memory`);
    console.log(`[memory] manage: GET/POST/PATCH/DELETE /memories`);
  });
}

start().catch((err) => {
  console.error("[memory] fatal:", err);
  process.exitCode = 1;
});
