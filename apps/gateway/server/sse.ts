import http from "node:http";

export function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",

    // Reduce the chance that proxies buffer SSE.
    // (Some reverse proxies like nginx honor this header.)
    "X-Accel-Buffering": "no"
  };
}

export function initSse(res: http.ServerResponse) {
  try {
    // Push headers immediately.
    (res as any).flushHeaders?.();
  } catch {
    // ignore
  }
  try {
    // Reduce packet coalescing (Nagle) for more responsive streaming.
    (res.socket as any)?.setNoDelay?.(true);
  } catch {
    // ignore
  }
}

export function send(res: http.ServerResponse, event: string, data: any) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify({ at: Date.now(), ...data })}\n\n`);
}

export function startSseKeepAlive(res: http.ServerResponse, intervalMs: number = 15_000) {
  const t = setInterval(() => {
    if (res.writableEnded) return;
    try {
      // SSE comment line to keep proxies/clients from timing out idle connections.
      res.write(`:keepalive ${Date.now()}\n\n`);
    } catch {
      // ignore
    }
  }, intervalMs);

  // Don't keep the Node process alive just because of keepalives.
  (t as any).unref?.();

  const stop = () => {
    try {
      clearInterval(t);
    } catch {
      // ignore
    }
  };

  res.on("close", stop);
  res.on("finish", stop);
  return stop;
}
