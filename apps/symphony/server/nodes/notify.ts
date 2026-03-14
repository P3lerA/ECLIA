/**
 * notify — Action node.
 *
 * Sends a message to a platform adapter (Discord or Telegram)
 * by posting to the adapter's /send endpoint.
 *
 * Input ports:
 *   text : string  — the message to send
 *
 * Output ports:
 *   ok : boolean  — whether the send succeeded
 */

import type { NodeFactory } from "../types.js";

async function adapterSend(
  baseUrl: string,
  adapterKey: string | undefined,
  origin: Record<string, unknown>,
  content: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, "")}/send`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (adapterKey) headers["x-eclia-adapter-key"] = adapterKey;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  // Abort if the node's signal fires too
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ origin, content, refs: [] }),
      signal: ctrl.signal as any,
    });
    const j = (await r.json().catch(() => null)) as any;
    if (!r.ok || !j?.ok) {
      const err = typeof j?.error === "string" ? j.error : `http_${r.status}`;
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.name === "AbortError" ? "timeout" : e?.message ?? e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(t);
    signal.removeEventListener("abort", onAbort);
  }
}

function resolveAdapterUrl(destination: string): string {
  if (destination === "discord") {
    const explicit = (process.env.ECLIA_DISCORD_ADAPTER_URL ?? "").trim();
    if (explicit) return explicit;
    const port = Number(process.env.ECLIA_DISCORD_ADAPTER_PORT ?? "8790");
    return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 8790}`;
  }
  if (destination === "telegram") {
    const explicit = (process.env.ECLIA_TELEGRAM_ADAPTER_URL ?? "").trim();
    if (explicit) return explicit;
    const port = Number(process.env.ECLIA_TELEGRAM_ADAPTER_PORT ?? "8791");
    return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 8791}`;
  }
  throw new Error(`Unknown destination: ${destination}`);
}

export const factory: NodeFactory = {
  kind: "notify",
  label: "Notify",
  role: "action",
  description: "Send a message to any adapter",

  inputPorts: [
    { key: "text", label: "Text", type: "string" },
  ],
  outputPorts: [
    { key: "ok", label: "OK", type: "boolean" },
  ],

  configSchema: [
    {
      key: "sendDestination",
      label: "Destination",
      type: "select",
      options: ["discord", "telegram"],
      default: "discord",
    },
    {
      key: "sendChannelId",
      label: "Channel ID",
      type: "string",
      placeholder: "Channel / Chat ID",
    },
  ],

  create(id, config) {
    return {
      role: "action" as const,
      id,
      kind: "notify",

      async execute(ctx) {
        const text = ctx.inputs.text as string | undefined;
        if (!text) {
          ctx.log.warn("notify: empty text, skipping");
          return { ok: false };
        }

        const dest = String(config.sendDestination ?? "discord");
        const channelId = String(config.sendChannelId ?? "");

        if (!channelId) {
          ctx.log.error(`notify: ${dest} requires a channel/chat ID`);
          return { ok: false };
        }

        const baseUrl = resolveAdapterUrl(dest);
        const adapterKey = (process.env.ECLIA_ADAPTER_KEY ?? "").trim() || undefined;

        const origin: Record<string, unknown> = { kind: dest };
        if (dest === "discord") origin.channelId = channelId;
        if (dest === "telegram") origin.chatId = channelId;

        // Platform message length limits (Discord: 4000, Telegram: 4096).
        const maxLen = dest === "telegram" ? 4096 : 4000;
        const content = text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;

        const result = await adapterSend(baseUrl, adapterKey, origin, content, ctx.signal);

        if (result.ok) {
          ctx.log.info(`notify → ${dest} (${channelId})`);
        } else {
          ctx.log.error(`notify ${dest} failed: ${result.error}`);
        }

        return { ok: result.ok };
      },
    };
  },
};
