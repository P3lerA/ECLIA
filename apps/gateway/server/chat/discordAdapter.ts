type DiscordAdapterSendError = {
  code: string;
  message: string;
};

export function guessDiscordAdapterBaseUrl(): string {
  const explicit = (process.env.ECLIA_DISCORD_ADAPTER_URL ?? "").trim();
  if (explicit) return explicit;
  const portRaw = (process.env.ECLIA_DISCORD_ADAPTER_PORT ?? "8790").trim();
  const port = Number(portRaw);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 8790}`;
}

export async function postDiscordAdapterSend(args: {
  adapterBaseUrl: string;
  adapterKey?: string;
  origin: any;
  content: string;
  refs: string[];
}): Promise<{ ok: true } | { ok: false; error: DiscordAdapterSendError }> {
  const url = `${args.adapterBaseUrl.replace(/\/$/, "")}/send`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = typeof args.adapterKey === "string" ? args.adapterKey.trim() : "";
  if (key) headers["x-eclia-adapter-key"] = key;

  const payload = {
    origin: args.origin,
    content: args.content,
    refs: Array.isArray(args.refs) ? args.refs : []
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: ctrl.signal as any });
    const j = (await r.json().catch(() => null)) as any;
    if (!r.ok || !j?.ok) {
      const err = typeof j?.error === "string" ? j.error : `http_${r.status}`;
      return { ok: false, error: { code: "send_failed", message: `Discord adapter send failed: ${err}` } };
    }
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.name === "AbortError" ? "timeout" : e?.message ?? e);
    return { ok: false, error: { code: "adapter_unreachable", message: `Discord adapter unreachable: ${msg}` } };
  } finally {
    clearTimeout(t);
  }
}
