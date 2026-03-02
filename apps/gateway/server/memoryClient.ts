import type { EcliaConfig } from "@eclia/config";

export type RecallTranscriptMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
};

export type RetrievedMemory = {
  id: string;
  raw: string;
  score: number | null;
};

function memoryBaseUrl(config: EcliaConfig): string | null {
  const enabled = Boolean((config as any)?.memory?.enabled ?? false);
  if (!enabled) return null;

  const host = String((config as any)?.memory?.host ?? "127.0.0.1").trim();
  const portRaw = (config as any)?.memory?.port;
  const port = typeof portRaw === "number" ? portRaw : typeof portRaw === "string" ? Number(portRaw) : NaN;
  const portNum = Number.isFinite(port) ? Math.trunc(port) : 8788;

  if (!host) return null;
  return `http://${host}:${portNum}`;
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs: number }
): Promise<{ ok: boolean; status: number; data: any } | null> {
  const { timeoutMs, ...rest } = init;
  let timer: any = null;
  const ctrl = new AbortController();

  // Respect an upstream signal if provided.
  const upstreamSignal = (rest as any).signal as AbortSignal | undefined;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) ctrl.abort();
    else upstreamSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  try {
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, { ...rest, signal: ctrl.signal });
    const status = resp.status;
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    return { ok: resp.ok, status, data };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function recallMemories(args: {
  config: EcliaConfig;
  sessionId: string;
  userText: string;
  /** Recent transcript (last N turns) for fallback keyword recall. */
  recentTranscript: RecallTranscriptMessage[];
  limit?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<RetrievedMemory[] | null> {
  const baseUrl = memoryBaseUrl(args.config);
  if (!baseUrl) return null;

  const sessionId = String(args.sessionId ?? "").trim();
  const userText = String(args.userText ?? "").trim();
  const recentTranscript = Array.isArray(args.recentTranscript) ? args.recentTranscript : [];

  if (!sessionId || !userText) return null;

  const cfgLimitRaw = (args.config as any)?.memory?.recall_limit;
  const cfgLimitNum =
    typeof cfgLimitRaw === "number" ? cfgLimitRaw : typeof cfgLimitRaw === "string" ? Number(cfgLimitRaw) : NaN;
  const cfgLimit = Number.isFinite(cfgLimitNum) ? Math.trunc(cfgLimitNum) : 20;

  const limit =
    typeof args.limit === "number" && Number.isFinite(args.limit)
      ? Math.max(0, Math.min(200, Math.trunc(args.limit)))
      : Math.max(0, Math.min(200, cfgLimit));

  const resp = await fetchJson(`${baseUrl}/recall`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ sessionId, userText, recentTranscript, limit }),
    timeoutMs:
      typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
        ? args.timeoutMs
        : (() => {
            const raw = (args.config as any)?.memory?.timeout_ms;
            const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
            const i = Number.isFinite(n) ? Math.trunc(n) : 1200;
            return Math.max(50, Math.min(60_000, i));
          })(),
    signal: args.signal
  });

  if (!resp || !resp.ok) return null;
  const data = resp.data;
  if (!data || data.ok !== true || !Array.isArray(data.memories)) return null;

  const out: RetrievedMemory[] = [];
  for (const row of data.memories as any[]) {
    const id = typeof row?.id === "string" ? String(row.id).trim() : "";
    const raw = typeof row?.raw === "string" ? String(row.raw) : "";
    if (!id || !raw.trim()) continue;

    const score = typeof row?.score === "number" && Number.isFinite(row.score) ? row.score : null;
    out.push({ id, raw, score });
  }

  return out;
}
