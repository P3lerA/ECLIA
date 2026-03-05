export async function fetchJson(
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
