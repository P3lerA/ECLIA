import http from "node:http";
import { embedTexts } from "../embeddingClient.js";
import { writeMetaIfNeeded } from "../db/metaRepo.js";
import { json, readJson } from "@eclia/gateway-client/utils";
import { asString, clampInt } from "@eclia/utils";
import {
  listFactsManage,
  createFact,
  updateFact,
  deleteFact,
  recallFacts,
  logActivation,
  makeFactNodeId,
  type MemoryDb
} from "../memoryDb.js";

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
  recentTranscript: ChatMessage[];
  limit?: number;
};

type EmbeddingsCtx = {
  ensureSidecar: (model: string) => Promise<string | null>;
  embeddingsModel: string;
  timeoutMs: number;
};

export async function handleRecall(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: {
    db: MemoryDb;
    recallMinScore?: number;
  } & EmbeddingsCtx
) {
  const body = (await readJson(req)) as Partial<RecallRequest>;
  const sessionId = asString(body.sessionId).trim();
  const userText = asString(body.userText).trim();
  const recentTranscript = Array.isArray((body as any).recentTranscript) ? ((body as any).recentTranscript as any[]) : [];

  if (!sessionId || !userText) {
    return json(res, 400, { ok: false, error: "invalid_request" });
  }

  void recentTranscript;

  const limit = clampInt(body.limit, 0, 200, 20);

  let qVec: Float32Array | null = null;
  const modelName = ctx.embeddingsModel;
  const liveUrl = modelName ? await ctx.ensureSidecar(modelName) : null;
  console.log(`[memory] recall: modelName=${modelName} liveUrl=${liveUrl}`);
  if (liveUrl) {
    const embedded = await embedTexts({ baseUrl: liveUrl, texts: [userText], timeoutMs: ctx.timeoutMs });
    console.log(`[memory] recall: embedded ok=${!!embedded} vectors=${embedded?.vectors?.length} vec0type=${embedded?.vectors?.[0]?.constructor?.name} vec0len=${embedded?.vectors?.[0]?.length}`);
    if (embedded?.vectors?.[0]) qVec = embedded.vectors[0];
  }
  console.log(`[memory] recall: qVec=${qVec ? `Float32Array(${qVec.length})` : "null"}`);

  const memories = await recallFacts({ db: ctx.db, queryVector: qVec, limit, minScore: ctx.recallMinScore });

  void logActivation({
    db: ctx.db,
    sourceSession: sessionId,
    nodes: memories.map((m) => ({ nodeId: makeFactNodeId(m.id), strength: typeof m.score === "number" ? m.score : 0 }))
  });

  return json(res, 200, { ok: true, memories });
}

export async function handleListMemories(req: http.IncomingMessage, res: http.ServerResponse, ctx: { db: MemoryDb }) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const q = url.searchParams.get("q") ?? "";
  const limit = clampInt(url.searchParams.get("limit"), 0, 500, 200);
  const offset = clampInt(url.searchParams.get("offset"), 0, 1_000_000, 0);

  const rows = await listFactsManage({ db: ctx.db, q, offset, limit });

  let total = 0;
  try {
    const c = await ctx.db.client.execute("SELECT COUNT(1) AS n FROM Fact;");
    const n = (c.rows?.[0] as any)?.n;
    total = typeof n === "number" ? n : typeof n === "bigint" ? Number(n) : Number(n) || 0;
  } catch {
    total = 0;
  }

  return json(res, 200, { ok: true, memories: rows, q, offset, limit, total });
}

export async function handleCreateMemory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: {
    db: MemoryDb;
  } & EmbeddingsCtx
) {
  const body = await readJson(req);
  const raw = asString(body?.raw);
  if (!raw.trim()) return json(res, 400, { ok: false, error: "raw is required" });
  const strengthRaw = body?.strength;
  const strength = typeof strengthRaw === "number" ? strengthRaw : typeof strengthRaw === "string" ? Number(strengthRaw) : undefined;

  let vectorS: Float32Array | null = null;
  const modelName = ctx.embeddingsModel;
  const liveUrl = modelName ? await ctx.ensureSidecar(modelName) : null;
  if (liveUrl) {
    const embedded = await embedTexts({ baseUrl: liveUrl, texts: [raw], normalize: false, timeoutMs: ctx.timeoutMs });
    if (embedded?.vectors?.[0]) {
      vectorS = embedded.vectors[0];
      if (embedded.dim > 0) writeMetaIfNeeded(ctx.db.client, modelName, embedded.dim).catch(() => {});
    }
  }

  const m = await createFact({
    db: ctx.db,
    raw,
    strength: Number.isFinite(Number(strength)) ? Number(strength) : undefined,
    vectorS
  });

  return json(res, 201, { ok: true, memory: m });
}

export async function handleUpdateMemory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
  ctx: {
    db: MemoryDb;
  } & EmbeddingsCtx
) {
  const body = await readJson(req);
  const raw = typeof body?.raw === "string" ? String(body.raw) : undefined;
  const strengthRaw = body?.strength;
  const strength = typeof strengthRaw === "number" ? strengthRaw : typeof strengthRaw === "string" ? Number(strengthRaw) : undefined;

  let vectorS: Float32Array | null | undefined = undefined;
  if (typeof raw === "string") {
    const next = raw.trim();
    if (next) {
      const modelName = ctx.embeddingsModel;
      const liveUrl = modelName ? await ctx.ensureSidecar(modelName) : null;
      if (liveUrl) {
        const embedded = await embedTexts({ baseUrl: liveUrl, texts: [next], normalize: false, timeoutMs: ctx.timeoutMs });
        if (embedded?.vectors?.[0]) {
          vectorS = embedded.vectors[0];
          if (embedded.dim > 0) writeMetaIfNeeded(ctx.db.client, modelName, embedded.dim).catch(() => {});
        } else vectorS = null;
      } else {
        vectorS = null;
      }
    }
  }

  const m = await updateFact({
    db: ctx.db,
    id,
    patch: {
      ...(typeof raw === "string" ? { raw } : {}),
      ...(typeof strength === "number" && Number.isFinite(strength) ? { strength } : {}),
      ...(vectorS !== undefined ? { vectorS } : {})
    }
  });

  if (!m) return json(res, 404, { ok: false, error: "not_found" });
  return json(res, 200, { ok: true, memory: m });
}

export async function handleDeleteMemory(res: http.ServerResponse, id: string, ctx: { db: MemoryDb }) {
  const ok = await deleteFact({ db: ctx.db, id });
  if (!ok) return json(res, 404, { ok: false, error: "not_found" });
  return json(res, 200, { ok: true, deleted: true, id });
}
