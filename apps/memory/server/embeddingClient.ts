import { fetchJson, asString } from "@eclia/utils";

export type EmbeddingsHealth = {
  ok: true;
  service: "embeddings";
  model: string;
  dim: number;
  ts: number;
};

export type EmbedTextsResult = {
  model: string;
  dim: number;
  vectors: Float32Array[];
};

function asInt(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

export async function getEmbeddingsHealth(args: {
  baseUrl: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<EmbeddingsHealth | null> {
  const baseUrl = String(args.baseUrl ?? "").trim();
  if (!baseUrl) return null;

  const resp = await fetchJson(`${baseUrl}/health`, {
    method: "GET",
    timeoutMs: typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) ? args.timeoutMs : 1000,
    signal: args.signal
  });

  if (!resp || !resp.ok) return null;
  const d = resp.data;
  if (!d || d.ok !== true) return null;

  const model = asString(d.model).trim();
  const dim = asInt(d.dim);
  const ts = asInt(d.ts);

  if (!model || !Number.isFinite(dim)) return null;

  return {
    ok: true,
    service: "embeddings",
    model,
    dim,
    ts: Number.isFinite(ts) ? ts : Date.now()
  };
}

export async function embedTexts(args: {
  baseUrl: string;
  texts: string[];
  normalize?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<EmbedTextsResult | null> {
  const baseUrl = String(args.baseUrl ?? "").trim();
  if (!baseUrl) return null;

  const texts = Array.isArray(args.texts) ? args.texts.map((t) => String(t ?? "")) : [];

  const resp = await fetchJson(`${baseUrl}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ texts, normalize: args.normalize ?? true }),
    timeoutMs: typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) ? args.timeoutMs : 10_000,
    signal: args.signal
  });

  if (!resp || !resp.ok) return null;
  const d = resp.data;
  if (!d || d.ok !== true || !Array.isArray(d.embeddings)) return null;

  const model = asString(d.model).trim();
  const dim = asInt(d.dim);
  if (!model || !Number.isFinite(dim) || dim <= 0) return null;

  const vectors: Float32Array[] = [];
  for (const row of d.embeddings as any[]) {
    if (!Array.isArray(row)) continue;
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      const n = typeof row[i] === "number" ? row[i] : typeof row[i] === "string" ? Number(row[i]) : NaN;
      v[i] = Number.isFinite(n) ? n : 0;
    }
    vectors.push(v);
  }

  return { model, dim, vectors };
}
