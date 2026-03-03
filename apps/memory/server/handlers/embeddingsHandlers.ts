import http from "node:http";
import { asString, json, readJson } from "../httpUtils.js";
import { isModelCached, proxySidecar } from "../sidecarManager.js";

type EmbeddingsCtx = {
  ensureSidecar: (model: string) => Promise<string | null>;
};

export async function handleEmbeddingsStatus(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const model = url.searchParams.get("model")?.trim() ?? "";
  if (!model) return json(res, 400, { ok: false, error: "model query param is required" });

  const cached = isModelCached(model);
  return json(res, 200, { ok: true, model, cached });
}

export async function handleEmbeddingsDownload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: EmbeddingsCtx
) {
  const body = await readJson(req);
  const model = asString(body?.name).trim();
  if (!model) return json(res, 400, { ok: false, error: "name is required" });

  const liveUrl = await ctx.ensureSidecar(model);
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

export async function handleEmbeddingsDelete(req: http.IncomingMessage, res: http.ServerResponse, ctx: EmbeddingsCtx) {
  const body = await readJson(req);
  const model = asString(body?.name).trim();
  if (!model) return json(res, 400, { ok: false, error: "name is required" });

  const liveUrl = await ctx.ensureSidecar(model);
  if (!liveUrl) return json(res, 503, { ok: false, error: "embeddings sidecar not running" });

  const r = await proxySidecar(liveUrl, "/model/delete", {
    method: "POST",
    body: JSON.stringify({ name: model }),
    timeoutMs: 10_000
  });
  if (!r) return json(res, 502, { ok: false, error: "sidecar unreachable" });
  return json(res, r.status, r.data);
}
