import http from "node:http";
import { json, readJson } from "@eclia/gateway-client/utils";
import { asString, clampInt } from "@eclia/utils";
import type { JsonMemoryStore } from "../store/jsonStore.js";

type StoreCtx = { store: JsonMemoryStore };

export function handleGetAllFacts(res: http.ServerResponse, ctx: StoreCtx) {
  const facts = ctx.store.allFacts();
  const lines = facts.map((f) => `[${f.id}] ${f.raw.trim()}`).filter((l) => l.length > 4);
  return json(res, 200, { ok: true, facts: lines, count: lines.length });
}

export async function handleListMemories(req: http.IncomingMessage, res: http.ServerResponse, ctx: StoreCtx) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const q = url.searchParams.get("q") ?? "";
  const limit = clampInt(url.searchParams.get("limit"), 0, 500, 200);
  const offset = clampInt(url.searchParams.get("offset"), 0, 1_000_000, 0);

  const { facts, total } = ctx.store.listFacts(q, offset, limit);
  return json(res, 200, { ok: true, memories: facts, q, offset, limit, total });
}

export async function handleCreateMemory(req: http.IncomingMessage, res: http.ServerResponse, ctx: StoreCtx) {
  const body = await readJson(req);
  const raw = asString(body?.raw);
  if (!raw.trim()) return json(res, 400, { ok: false, error: "raw is required" });

  const m = await ctx.store.createFact(raw);
  return json(res, 201, { ok: true, memory: m });
}

export async function handleUpdateMemory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
  ctx: StoreCtx
) {
  const body = await readJson(req);
  const raw = typeof body?.raw === "string" ? String(body.raw) : undefined;
  if (raw === undefined) return json(res, 400, { ok: false, error: "raw is required" });

  const m = await ctx.store.updateFact(id, raw);
  if (!m) return json(res, 404, { ok: false, error: "not_found" });
  return json(res, 200, { ok: true, memory: m });
}

export async function handleDeleteMemory(res: http.ServerResponse, id: string, ctx: StoreCtx) {
  const ok = await ctx.store.deleteFact(id);
  if (!ok) return json(res, 404, { ok: false, error: "not_found" });
  return json(res, 200, { ok: true, deleted: true, id });
}
