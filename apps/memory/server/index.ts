import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEcliaConfig } from "@eclia/config";
import { spawnEmbeddingsSidecar, waitForSidecar } from "./embeddingsSidecar.js";

/**
 * Memory service (skeleton)
 *
 * Gateway integration point:
 *   - POST /recall  (before prompt assembly)
 *
 * Notes:
 * - In-memory store only (no persistence)
 * - Ingestion/update pipeline is owned by the memory service (not exposed via gateway endpoints here)
 */

type Role = "system" | "user" | "assistant" | "tool";

type ChatMessage = {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
};

type RecallRequest = {
  sessionId: string;
  userText: string;
  /** Recent transcript (last N turns), supplied by the gateway. */
  recentTranscript: ChatMessage[];
  limit?: number;
};

type MemorySnippet = {
  id: string;
  raw: string;
  createdAt: number;
  // Optional score for future ranking.
  score?: number;
};

// ---------------------------------------------------------------------------
// Minimal HTTP helpers
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// In-memory store (MVP)
// ---------------------------------------------------------------------------

/** sessionId -> snippets (most recent last) */
const memoryBySession = new Map<string, MemorySnippet[]>();

function getSnippets(sessionId: string): MemorySnippet[] {
  const s = sessionId.trim();
  if (!s) return [];
  return memoryBySession.get(s) ?? [];
}

// ---------------------------------------------------------------------------
// HuggingFace cache check (filesystem, no sidecar needed)
// ---------------------------------------------------------------------------

function hfCacheDir(): string {
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  const hfHome = process.env.HF_HOME ?? path.join(os.homedir(), ".cache", "huggingface");
  return path.join(hfHome, "hub");
}

function isModelCached(modelName: string): boolean {
  function check(name: string): boolean {
    const safeName = "models--" + name.replace(/\//g, "--");
    const snapshotsDir = path.join(hfCacheDir(), safeName, "snapshots");
    try {
      return fs.readdirSync(snapshotsDir).length > 0;
    } catch {
      return false;
    }
  }
  if (check(modelName)) return true;
  // sentence-transformers auto-prefixes short names with "sentence-transformers/"
  if (!modelName.includes("/")) return check(`sentence-transformers/${modelName}`);
  return false;
}

// ---------------------------------------------------------------------------
// Sidecar proxy helper
// ---------------------------------------------------------------------------

async function proxySidecar(
  sidecarBaseUrl: string | null,
  path: string,
  init: { method: string; body?: string; timeoutMs?: number }
): Promise<{ ok: boolean; status: number; data: any } | null> {
  if (!sidecarBaseUrl) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 120_000);

  try {
    const resp = await fetch(`${sidecarBaseUrl}${path}`, {
      method: init.method,
      headers: init.body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
      body: init.body,
      signal: ctrl.signal
    });
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleRecall(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = (await readJson(req)) as Partial<RecallRequest>;
  const sessionId = asString(body.sessionId).trim();
  const userText = asString(body.userText).trim();

  const recentTranscript = Array.isArray((body as any).recentTranscript) ? ((body as any).recentTranscript as any[]) : [];

  if (!sessionId || !userText) {
    return json(res, 400, { ok: false, error: "invalid_request" });
  }

  // NOTE: The memory service receives recentTranscript for future use (fallback keyword recall),
  // but the retrieval logic is intentionally not implemented in this skeleton.
  void recentTranscript;

  const limit = clampInt(body.limit, 0, 200, 20);

  const all = getSnippets(sessionId);

  // MVP ranking: newest first (placeholder). Future: semantic + heuristic graph recall.
  const slice = all.slice(-limit).reverse();

  return json(res, 200, {
    ok: true,
    memories: slice.map((m) => ({
      id: m.id,
      raw: m.raw,
      score: typeof m.score === "number" && Number.isFinite(m.score) ? m.score : null
    }))
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function start() {
  const { rootDir, config } = loadEcliaConfig(process.cwd());

  const host = String((config as any)?.memory?.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const portRaw = (config as any)?.memory?.port;
  const portNum = typeof portRaw === "number" ? portRaw : typeof portRaw === "string" ? Number(portRaw) : 8788;
  const port = Number.isFinite(portNum) ? Math.trunc(portNum) : 8788;

  const embeddingsModel = String((config as any)?.memory?.embeddings?.model ?? "").trim();
  const embeddingsPort = port < 65535 ? port + 1 : 8789;
  let sidecar = spawnEmbeddingsSidecar({ rootDir, model: embeddingsModel, host: "127.0.0.1", port: embeddingsPort });

  // Spawn a sidecar on demand (e.g. for download requests when none is running).
  // Uses the requested model name so the sidecar starts without trying to load any model.
  let sidecarSpawning = false;
  async function ensureSidecar(modelName: string): Promise<string | null> {
    // Already have a live sidecar.
    if (sidecar) {
      // Quick liveness check.
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 1_500);
        const r = await fetch(`${sidecar.baseUrl}/health`, { signal: ctrl.signal });
        if (r.ok) return sidecar.baseUrl;
      } catch {
        // fell through — sidecar died, respawn below
      }
    }

    if (sidecarSpawning) {
      // Another request is already spawning; wait up to 30s for it.
      const deadline = Date.now() + 30_000;
      while (sidecarSpawning && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
      }
      return sidecar?.baseUrl ?? null;
    }

    sidecarSpawning = true;
    try {
      const handle = spawnEmbeddingsSidecar({ rootDir, model: modelName || "all-MiniLM-L6-v2", host: "127.0.0.1", port: embeddingsPort });
      if (!handle) return null;
      sidecar = handle;
      const ready = await waitForSidecar(handle.baseUrl, 30_000);
      if (!ready) {
        console.warn("[memory] sidecar did not become ready within 30s — Python deps may be missing");
        return null;
      }
      return handle.baseUrl;
    } finally {
      sidecarSpawning = false;
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const { pathname } = url;

    // CORS (dev only)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.end();

    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "memory",
        ts: now(),
        embeddings: sidecar
          ? { ok: true, model: sidecar.model, baseUrl: sidecar.baseUrl }
          : embeddingsModel
            ? { ok: false, model: embeddingsModel }
            : { ok: false }
      });
    }

    if (req.method === "POST" && pathname === "/recall") return await handleRecall(req, res);

    // -- Embeddings model management (proxy to sidecar) ---------------------

    const sidecarUrl = sidecar?.baseUrl ?? null;

    if (req.method === "GET" && pathname === "/embeddings/status") {
      const model = url.searchParams.get("model")?.trim() ?? "";
      if (!model) return json(res, 400, { ok: false, error: "model query param is required" });

      // Filesystem check — no sidecar needed.
      const cached = isModelCached(model);
      return json(res, 200, { ok: true, model, cached });
    }

    if (req.method === "POST" && pathname === "/embeddings/download") {
      const body = await readJson(req);
      const model = asString(body?.name).trim();
      if (!model) return json(res, 400, { ok: false, error: "name is required" });

      // Auto-spawn sidecar if not running. Download can take minutes.
      const liveUrl = await ensureSidecar(model);
      if (!liveUrl) return json(res, 503, {
        ok: false,
        error: "embeddings sidecar failed to start — run: python3 -m venv apps/memory/sidecar/.venv && apps/memory/sidecar/.venv/bin/pip install -r apps/memory/sidecar/requirements.txt"
      });

      const r = await proxySidecar(liveUrl, "/model/download", {
        method: "POST",
        body: JSON.stringify({ name: model }),
        timeoutMs: 600_000
      });
      if (!r) return json(res, 502, { ok: false, error: "sidecar unreachable" });
      return json(res, r.status, r.data);
    }

    if (req.method === "POST" && pathname === "/embeddings/delete") {
      const body = await readJson(req);
      const model = asString(body?.name).trim();
      if (!model) return json(res, 400, { ok: false, error: "name is required" });

      const liveUrl = await ensureSidecar(model);
      if (!liveUrl) return json(res, 503, { ok: false, error: "embeddings sidecar not running" });

      const r = await proxySidecar(liveUrl, "/model/delete", {
        method: "POST",
        body: JSON.stringify({ name: model }),
        timeoutMs: 10_000
      });
      if (!r) return json(res, 502, { ok: false, error: "sidecar unreachable" });
      return json(res, r.status, r.data);
    }

    return json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, host, () => {
    console.log(`[memory] listening on http://${host}:${port}`);
    console.log(`[memory] store: in-memory (no persistence)`);
    console.log(`[memory] endpoint: POST /recall`);
    if (sidecar) {
      console.log(`[memory] embeddings: ${sidecar.baseUrl} model=${sidecar.model}`);
    } else {
      console.log(`[memory] embeddings: disabled (set memory.embeddings.model to enable)`);
    }
  });

  // Seed the store with nothing (intentionally). Real ingestion is owned by the memory service.
}

start();
