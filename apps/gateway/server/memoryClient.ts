import type { EcliaConfig } from "@eclia/config";
import { fetchJson } from "@eclia/utils";

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

/**
 * Fetch the full memory profile from the memory service.
 * Returns all facts joined as text for system prompt injection, or null if unavailable.
 */
export async function fetchMemoryProfile(args: {
  config: EcliaConfig;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  const baseUrl = memoryBaseUrl(args.config);
  if (!baseUrl) return null;

  const cfgTimeout = (() => {
    const raw = (args.config as any)?.memory?.timeout_ms;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    const i = Number.isFinite(n) ? Math.trunc(n) : 3000;
    return Math.max(50, Math.min(60_000, i));
  })();

  const resp = await fetchJson(`${baseUrl}/profile`, {
    method: "GET",
    timeoutMs: typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) ? args.timeoutMs : cfgTimeout,
    signal: args.signal
  });

  if (!resp || !resp.ok) return null;
  const data = resp.data;
  if (!data || data.ok !== true || !Array.isArray(data.facts)) return null;

  const facts = (data.facts as string[]).filter((f) => typeof f === "string" && f.trim());
  if (!facts.length) return null;

  return facts.join("\n");
}
