import http from "node:http";

export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  return (v ?? fallback ?? "").trim();
}

export function hasEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function boolEnv(name: string): boolean {
  const v = env(name).toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function normalizeIdList(input: unknown): string[] {
  const raw: string[] = [];

  if (Array.isArray(input)) {
    for (const x of input) {
      const s = typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "";
      if (s) raw.push(s);
    }
  } else if (typeof input === "string") {
    for (const part of input.split(/[\n\r,\t\s]+/g)) {
      const s = part.trim();
      if (s) raw.push(s);
    }
  }

  // De-dup while preserving order.
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const s of raw) {
    if (seen.has(s)) continue;
    seen.add(s);
    uniq.push(s);
  }
  return uniq;
}

export function json(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

export async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function explainFetchError(e: any): string {
  const msg = String(e?.message ?? e);
  const c: any = e && typeof e === "object" ? (e as any).cause : null;
  if (c && typeof c === "object") {
    const code = c.code || c.errno;
    const cmsg = c.message;
    const parts = [code, cmsg].filter(Boolean).join(": ");
    return parts ? `${msg} (${parts})` : msg;
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const ADAPTER_LOG_LABEL_PAD = 16;

function adapterLogPrefix(name: string): string {
  const label = `adapter:${String(name ?? "").trim().toLowerCase() || "unknown"}`;
  return `[${label.padEnd(ADAPTER_LOG_LABEL_PAD, " ")}]`;
}

export function makeAdapterLogger(name: string): {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
} {
  const prefix = adapterLogPrefix(name);
  return {
    info: (...args: any[]) => console.log(prefix, ...args),
    warn: (...args: any[]) => console.warn(prefix, ...args),
    error: (...args: any[]) => console.error(prefix, ...args)
  };
}
