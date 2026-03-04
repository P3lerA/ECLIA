import http from "node:http";

import { json, now, readJson } from "../httpUtils.js";
import type { ToolSessionLogger } from "../tools/toolSessionLogger.js";
import { MEMORY_TOOL_NAME, validateMemoryToolArgs } from "../tools/memoryTool.js";
import type { GenesisState } from "../genesisState.js";
import type { MemoryDb } from "../memoryDb.js";
import { createFact, deleteFact, logActivation, makeFactNodeId, mergeFacts } from "../memoryDb.js";
import { embedTexts } from "../embeddingClient.js";
import { writeMetaIfNeeded } from "../db/metaRepo.js";

export async function handleMemoryTool(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: {
    toolLogger: ToolSessionLogger;
    genesis?: GenesisState;
    db: MemoryDb;
    ensureSidecar: (model: string) => Promise<string | null>;
    embeddingsModel: string;
    timeoutMs: number;
  }
) {
  const body = await readJson(req);
  const vr = validateMemoryToolArgs(body);

  const ts = now();

  if (!vr.ok) {
    await ctx.toolLogger.append({
      ts,
      kind: "tool_error",
      tool: MEMORY_TOOL_NAME,
      error: vr.error,
      issues: vr.issues
    });

    return json(res, 400, {
      ok: false,
      error: "invalid_tool_args",
      tool: MEMORY_TOOL_NAME,
      issues: vr.issues
    });
  }

  await ctx.toolLogger.append({
    ts,
    kind: "tool_call",
    tool: MEMORY_TOOL_NAME,
    args: vr.value
  });

  const { action } = vr.value;

  if (action === "delete") return handleDelete(res, ctx, vr.value.ids);
  if (action === "merge") return handleMerge(res, ctx, vr.value.ids, vr.value.content);
  return handleExtract(res, ctx, vr.value.text, vr.value.timestamps);
}

// ---------------------------------------------------------------------------

async function handleExtract(
  res: http.ServerResponse,
  ctx: { genesis?: GenesisState; db: MemoryDb; ensureSidecar: (model: string) => Promise<string | null>; embeddingsModel: string; timeoutMs: number },
  text: string,
  timestamps: number[]
) {
  if (!text || !timestamps.length) {
    return json(res, 200, { ok: true, tool: MEMORY_TOOL_NAME, stored: false, reason: "empty_candidate" });
  }

  const vectorS = await computeEmbedding(ctx, text);

  const created = await createFact({ db: ctx.db, raw: text, strength: 1, vectorS });

  const nodeId = makeFactNodeId(created.id);
  const validTimestamps = timestamps
    .map((t: any) => {
      const n = typeof t === "number" ? t : typeof t === "string" ? Number(t) : NaN;
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    })
    .filter((tsSec: number) => tsSec > 0);

  for (const tsSec of validTimestamps) {
    await logActivation({ db: ctx.db, timestampSec: tsSec, nodes: [{ nodeId, strength: 1 }] });
  }

  if (ctx.genesis && ctx.genesis.isRunning()) {
    ctx.genesis.noteExtracted(1);
  }

  return json(res, 200, {
    ok: true,
    tool: MEMORY_TOOL_NAME,
    stored: true,
    id: created.id,
    activation: { timestamps: validTimestamps.length }
  });
}

async function handleDelete(
  res: http.ServerResponse,
  ctx: { db: MemoryDb },
  ids: number[]
) {
  let deleted = 0;
  for (const id of ids) {
    const ok = await deleteFact({ db: ctx.db, id: String(id) });
    if (ok) deleted++;
  }

  return json(res, 200, {
    ok: true,
    tool: MEMORY_TOOL_NAME,
    action: "delete",
    requested: ids.length,
    deleted
  });
}

async function handleMerge(
  res: http.ServerResponse,
  ctx: { db: MemoryDb; ensureSidecar: (model: string) => Promise<string | null>; embeddingsModel: string; timeoutMs: number },
  ids: number[],
  content: string
) {
  const vectorS = await computeEmbedding(ctx, content);

  const result = await mergeFacts({
    db: ctx.db,
    sourceIds: ids,
    raw: content,
    strength: 1,
    vectorS
  });

  return json(res, 200, {
    ok: true,
    tool: MEMORY_TOOL_NAME,
    action: "merge",
    created: { id: result.created.id },
    deletedIds: result.deletedIds
  });
}

// ---------------------------------------------------------------------------

async function computeEmbedding(
  ctx: { db: MemoryDb; ensureSidecar: (model: string) => Promise<string | null>; embeddingsModel: string; timeoutMs: number },
  text: string
): Promise<Float32Array | null> {
  const modelName = String(ctx.embeddingsModel ?? "").trim();
  if (!modelName) return null;

  const baseUrl = await ctx.ensureSidecar(modelName);
  if (!baseUrl) return null;

  try {
    const r = await embedTexts({ baseUrl, texts: [text], timeoutMs: ctx.timeoutMs });
    if (r?.vectors?.[0] instanceof Float32Array) {
      if (r.dim > 0) writeMetaIfNeeded(ctx.db.client, modelName, r.dim).catch(() => {});
      return r.vectors[0];
    }
    return null;
  } catch {
    return null;
  }
}
