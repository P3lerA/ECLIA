import http from "node:http";
import { loadEcliaConfig } from "@eclia/config";
import { openMemoryDb } from "./memoryDb.js";
import { json, now } from "./httpUtils.js";
import { createSidecarManager } from "./sidecarManager.js";
import {
  handleRecall,
  handleListMemories,
  handleCreateMemory,
  handleUpdateMemory,
  handleDeleteMemory
} from "./handlers/memoryHandlers.js";
import {
  handleEmbeddingsStatus,
  handleEmbeddingsDownload,
  handleEmbeddingsDelete
} from "./handlers/embeddingsHandlers.js";
import { handleMemoryTool } from "./handlers/memoryToolHandlers.js";
import { handleExtractRequest } from "./handlers/extractHandlers.js";
import { handleGenesisRun, handleGenesisStatus } from "./handlers/genesisHandlers.js";
import { createToolSessionLogger } from "./tools/toolSessionLogger.js";
import { createGenesisState } from "./genesisState.js";
import { getEmbeddingsMeta, setEmbeddingsMeta } from "./db/metaRepo.js";
import { getEmbeddingsHealth } from "./embeddingClient.js";
import { reembedAllFacts } from "./reembed.js";

async function start() {
  const { rootDir, config } = loadEcliaConfig(process.cwd());

  const host = String((config as any)?.memory?.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const portRaw = (config as any)?.memory?.port;
  const portNum = typeof portRaw === "number" ? portRaw : typeof portRaw === "string" ? Number(portRaw) : 8788;
  const port = Number.isFinite(portNum) ? Math.trunc(portNum) : 8788;

  const embeddingsModel = String((config as any)?.memory?.embeddings?.model ?? "").trim() || "all-MiniLM-L6-v2";
  const embeddingsPort = port < 65535 ? port + 1 : 8789;

  const timeoutRaw = (config as any)?.memory?.timeout_ms;
  const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : typeof timeoutRaw === "string" ? Number(timeoutRaw) : 1200;
  const timeout = Number.isFinite(timeoutMs) ? Math.trunc(timeoutMs) : 1200;

  const minScoreRaw = (config as any)?.memory?.recall_min_score;
  const recallMinScore = typeof minScoreRaw === "number" && Number.isFinite(minScoreRaw) ? minScoreRaw : 0.6;

  const db = await openMemoryDb({ rootDir, embeddingsModel });

  const sidecarManager = createSidecarManager({
    rootDir,
    defaultModel: embeddingsModel,
    host: "127.0.0.1",
    port: embeddingsPort
  });

  // --- Startup Meta Validation ---
  if (embeddingsModel) {
    const meta = await getEmbeddingsMeta(db.client);

    if (meta.model !== null && meta.model !== embeddingsModel) {
      // Model changed → re-embed all facts
      console.log(`[memory] embeddings model changed: stored="${meta.model}" configured="${embeddingsModel}"`);
      const baseUrl = await sidecarManager.ensureSidecar(embeddingsModel);
      if (!baseUrl) {
        console.error("[memory] FATAL: cannot start sidecar for re-embedding");
        process.exitCode = 1;
        return;
      }
      await reembedAllFacts({ client: db.client, sidecarBaseUrl: baseUrl, model: embeddingsModel, timeoutMs: 30_000 });
    } else if (meta.model === null) {
      // Fresh DB — try to write meta from sidecar health
      const baseUrl = await sidecarManager.ensureSidecar(embeddingsModel);
      if (baseUrl) {
        const health = await getEmbeddingsHealth({ baseUrl, timeoutMs: 5_000 });
        if (health && health.dim > 0) {
          await setEmbeddingsMeta(db.client, embeddingsModel, health.dim);
          console.log(`[memory] meta initialized: model=${embeddingsModel} dim=${health.dim}`);
        }
      }
    } else {
      console.log(`[memory] meta OK: model=${meta.model} dim=${meta.dim}`);
    }
  }

  const toolLogger = createToolSessionLogger({ rootDir, sessionId: "memory-tool" });

  const genesis = createGenesisState();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const { pathname } = url;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.end();

    const sidecar = sidecarManager.getSidecar();

    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "memory",
        ts: now(),
        db: { ok: true, path: db.dbPath, model: db.embeddingsModel },
        embeddings: sidecar
          ? { ok: true, model: sidecar.model, baseUrl: sidecar.baseUrl }
          : embeddingsModel
            ? { ok: false, model: embeddingsModel }
            : { ok: false }
      });
    }

    if (req.method === "POST" && pathname === "/recall") {
      return await handleRecall(req, res, {
        db,
        ensureSidecar: sidecarManager.ensureSidecar,
        embeddingsModel,
        timeoutMs: timeout,
        recallMinScore
      });
    }

    if (req.method === "POST" && pathname === "/extract") {
      return await handleExtractRequest(req, res);
    }

    if (req.method === "POST" && pathname === "/tools/memory") {
      return await handleMemoryTool(req, res, {
        toolLogger,
        genesis,
        db,
        ensureSidecar: sidecarManager.ensureSidecar,
        embeddingsModel,
        timeoutMs: timeout
      });
    }

    if (req.method === "POST" && pathname === "/genesis/run") {
      return await handleGenesisRun(req, res, { genesis, db });
    }

    if (req.method === "GET" && pathname === "/genesis/status") {
      return await handleGenesisStatus(res, { genesis });
    }

    if (req.method === "GET" && pathname === "/memories") return await handleListMemories(req, res, { db });

    if (req.method === "POST" && pathname === "/memories") {
      return await handleCreateMemory(req, res, {
        db,
        ensureSidecar: sidecarManager.ensureSidecar,
        embeddingsModel,
        timeoutMs: timeout
      });
    }

    if (pathname.startsWith("/memories/") && pathname.length > "/memories/".length) {
      const id = pathname.slice("/memories/".length);
      if (req.method === "PATCH") {
        return await handleUpdateMemory(req, res, id, {
          db,
          ensureSidecar: sidecarManager.ensureSidecar,
          embeddingsModel,
          timeoutMs: timeout
        });
      }
      if (req.method === "DELETE") return await handleDeleteMemory(res, id, { db });
    }

    if (req.method === "GET" && pathname === "/embeddings/status") {
      return await handleEmbeddingsStatus(req, res);
    }

    if (req.method === "POST" && pathname === "/embeddings/download") {
      return await handleEmbeddingsDownload(req, res, { ensureSidecar: sidecarManager.ensureSidecar });
    }

    if (req.method === "POST" && pathname === "/embeddings/delete") {
      return await handleEmbeddingsDelete(req, res, { ensureSidecar: sidecarManager.ensureSidecar });
    }

    return json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, host, () => {
    const sidecar = sidecarManager.getSidecar();
    console.log(`[memory] listening on http://${host}:${port}`);
    console.log(`[memory] store: libsql file=${db.dbPath}`);
    console.log(`[memory] endpoint: POST /recall`);
    console.log(`[memory] extract: POST /extract (dev/admin)`);
    console.log(`[memory] genesis: POST /genesis/run  GET /genesis/status`);
    console.log(`[memory] tool: POST /tools/memory  (audit: .eclia/memory/tool-sessions/${toolLogger.sessionId}.ndjson)`);
    console.log(`[memory] manage: GET/POST/PATCH/DELETE /memories`);
    if (sidecar) {
      console.log(`[memory] embeddings: ${sidecar.baseUrl} model=${sidecar.model}`);
    } else {
      console.log(`[memory] embeddings: disabled (set memory.embeddings.model to enable)`);
    }
  });
}

start().catch((err) => {
  console.error("[memory] fatal:", err);
  process.exitCode = 1;
});
