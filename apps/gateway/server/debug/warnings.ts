import fs from "node:fs";
import path from "node:path";

function safePathToken(s: string): string {
  const cleaned = String(s ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

/**
 * Best-effort session warning log.
 *
 * We append NDJSON lines under:
 *   <repo>/.eclia/debug/<sessionId>/warnings.ndjson
 *
 * This must never throw.
 */
export function appendSessionWarning(args: {
  rootDir: string;
  sessionId: string;
  event: Record<string, unknown>;
}) {
  try {
    const sid = safePathToken(args.sessionId || "unknown_session");
    const baseDir = path.join(args.rootDir, ".eclia", "debug", sid);
    fs.mkdirSync(baseDir, { recursive: true });

    const file = path.join(baseDir, "warnings.ndjson");
    const line = JSON.stringify({ ts: new Date().toISOString(), ...args.event });

    fs.appendFileSync(file, line + "\n", "utf-8");
  } catch {
    // ignore
  }
}
