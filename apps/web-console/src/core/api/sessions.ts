import type { Message, Session } from "../types";

export type SessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastModel?: string;
  // Optional extra metadata returned by the gateway.
  // Keep optional for compatibility with older gateways.
  messageCount?: number;
};

export type ListSessionsResponse =
  | { ok: true; sessions: SessionMeta[] }
  | { ok: false; error: string; hint?: string };

export type CreateSessionResponse =
  | { ok: true; session: SessionMeta }
  | { ok: false; error: string; hint?: string };

export type GetSessionResponse =
  | { ok: true; session: SessionMeta; messages: Message[] }
  | { ok: false; error: string; hint?: string };

export type ResetSessionResponse =
  | { ok: true; session: SessionMeta }
  | { ok: false; error: string; hint?: string };

export type DeleteSessionResponse =
  | { ok: true }
  | { ok: false; error: string; hint?: string };

export async function apiListSessions(limit = 200): Promise<SessionMeta[]> {
  const url = `/api/sessions?limit=${encodeURIComponent(String(limit))}`;
  const r = await fetch(url, { method: "GET" });
  const j = (await r.json()) as ListSessionsResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.sessions;
}

export async function apiCreateSession(
  arg?: string | { title?: string; id?: string }
): Promise<SessionMeta> {
  const payload: any = {};
  // Let the gateway know this session is attached to the web console.
  // (Tools like `send` can use this metadata to route outputs later.)
  payload.origin = { kind: "web" };
  if (typeof arg === "string") {
    payload.title = arg;
  } else if (arg && typeof arg === "object") {
    if (typeof arg.title === "string" && arg.title.trim()) payload.title = arg.title;
    if (typeof arg.id === "string" && arg.id.trim()) payload.id = arg.id;
  }

  const r = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = (await r.json()) as CreateSessionResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.session;
}

export async function apiGetSession(sessionId: string): Promise<{ session: SessionMeta; messages: Message[] }> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
  const j = (await r.json()) as GetSessionResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return { session: j.session, messages: j.messages };
}

export async function apiResetSession(sessionId: string): Promise<SessionMeta> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const j = (await r.json()) as ResetSessionResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.session;
}

export async function apiDeleteSession(sessionId: string): Promise<void> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  const j = (await r.json()) as DeleteSessionResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
}

/**
 * Convert a gateway SessionMeta into the UI Session shape.
 * UI uses a human-friendly meta string for now.
 */
export function toUiSession(meta: SessionMeta): Session {
  const started = typeof meta.messageCount === "number" ? meta.messageCount > 0 : undefined;
  return {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    meta: formatSessionMeta(meta.updatedAt),
    started
  };
}

function formatSessionMeta(updatedAt: number): string {
  const now = Date.now();
  const d = Math.max(0, now - updatedAt);

  if (d < 10_000) return "just now";
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;

  const dt = new Date(updatedAt);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
