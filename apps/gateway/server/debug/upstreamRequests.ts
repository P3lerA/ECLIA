import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function safePathToken(s: string): string {
  const cleaned = String(s ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

function isoForFilename(ts: string): string {
  // 2026-02-19T04:07:12.345Z -> 2026-02-19T04-07-12-345Z
  return ts.replace(/[:.]/g, "-");
}

/**
 * Best-effort debug dump of upstream request payloads.
 *
 * This intentionally:
 * - stores ONLY the request body + minimal metadata (no auth headers)
 * - never throws (debugging must not break inference)
 */
export function dumpUpstreamRequestBody(args: {
  rootDir: string;
  sessionId: string;
  seq: number;
  providerKind: string;
  upstreamModel?: string;
  url?: string;
  body: unknown;
}) {
  try {
    const sid = safePathToken(args.sessionId || "unknown_session");
    const baseDir = path.join(args.rootDir, ".eclia", "debug", sid);
    fs.mkdirSync(baseDir, { recursive: true });

    const ts = new Date().toISOString();
    const seq = Number.isFinite(args.seq) ? Math.max(0, Math.trunc(args.seq)) : 0;
    const rand = crypto.randomUUID().slice(0, 8);
    const provider = safePathToken(args.providerKind || "upstream");

    const file = `${String(seq).padStart(4, "0")}__${isoForFilename(ts)}__${provider}__${rand}.json`;
    const absPath = path.join(baseDir, file);

    const payload = {
      ts,
      provider: args.providerKind,
      upstreamModel: args.upstreamModel,
      url: args.url,
      body: args.body
    };

    fs.writeFileSync(absPath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // ignore
  }
}
