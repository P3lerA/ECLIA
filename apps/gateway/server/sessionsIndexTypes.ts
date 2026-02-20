import type { SessionMetaV1 } from "./sessionTypes.js";

/**
 * Append-only index of sessions (for fast listing / lookup).
 *
 * NOTE: meta.json remains the per-session source of truth for single-session reads.
 * sessions.ndjson is a convenience index that can be rebuilt by scanning session dirs.
 */
export type SessionsIndexEventV1 =
  | {
      v: 1;
      id: string;
      ts: number;
      type: "upsert";
      meta: SessionMetaV1;
    }
  | {
      v: 1;
      id: string;
      ts: number;
      type: "delete";
      sessionId: string;
    };
