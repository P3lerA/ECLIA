/**
 * Session metadata persisted per-session (/.eclia/sessions/<id>/meta.json).
 *
 * NOTE:
 * - Conversation transcripts are persisted separately in transcript.ndjson.
 * - UI projections (blocks, tool folding, etc.) are derived views and are not stored here.
 */

export type SessionMetaV1 = {
  v: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;

  /**
   * Optional: where this session lives (used by tools like `send`).
   * Examples:
   * - { kind: "web" }
   * - { kind: "discord", channelId: "...", threadId: "..." }
   */
  origin?: {
    kind: string;
    [k: string]: unknown;
  };

  /**
   * Optional: last used route key / upstream model, for UX.
   */
  lastModel?: string;
};
