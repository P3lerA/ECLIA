import http from "node:http";

import { SessionStore } from "../sessionStore.js";
import { json, readJson, safeDecodeSegment, safeInt } from "../httpUtils.js";

export async function handleSessions(req: http.IncomingMessage, res: http.ServerResponse, store: SessionStore) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const pathname = u.pathname;

  // /api/sessions
  if (pathname === "/api/sessions" && req.method === "GET") {
    const limit = safeInt(u.searchParams.get("limit"), 200);
    const sessions = await store.listSessions(limit);
    return json(res, 200, { ok: true, sessions });
  }

  if (pathname === "/api/sessions" && req.method === "POST") {
    const body = (await readJson(req)) as any;
    const title = typeof body?.title === "string" ? body.title : undefined;
    const id = typeof body?.id === "string" ? body.id : undefined;
    const origin = body?.origin && typeof body.origin === "object" ? body.origin : undefined;

    try {
      let meta = id
        ? await store.ensureSession(id, {
            v: 1,
            id,
            title: title && title.trim() ? title.trim() : "New session",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            origin
          })
        : await store.createSession(title);

      if (!id && origin) {
        // For new sessions, persist origin metadata (used by tools like `send`).
        meta = await store.updateMeta(meta.id, { origin });
      }

      // If caller provided a title and the existing session is still default, update it.
      if (id && title && title.trim() && meta.title === "New session") {
        meta = await store.updateMeta(id, { title: title.trim(), updatedAt: Date.now() });
      }

      return json(res, 200, { ok: true, session: meta });
    } catch {
      return json(res, 400, { ok: false, error: "invalid_session_id" });
    }
  }

  // /api/sessions/:id
  const m1 = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (m1 && req.method === "GET") {
    const id = safeDecodeSegment(m1[1]);
    if (!id) return json(res, 400, { ok: false, error: "invalid_session_id" });

    if (!store.isValidSessionId(id)) return json(res, 400, { ok: false, error: "invalid_session_id" });

    const detail = await store.readSession(id, { includeTools: true });
    if (!detail) return json(res, 404, { ok: false, error: "not_found" });
    return json(res, 200, { ok: true, session: detail.meta, messages: detail.messages });
  }

  // /api/sessions/:id/reset
  const m2 = pathname.match(/^\/api\/sessions\/([^/]+)\/reset$/);
  if (m2 && req.method === "POST") {
    const id = safeDecodeSegment(m2[1]);
    if (!id) return json(res, 400, { ok: false, error: "invalid_session_id" });

    if (!store.isValidSessionId(id)) return json(res, 400, { ok: false, error: "invalid_session_id" });
    try {
      const meta = await store.resetSession(id);
      return json(res, 200, { ok: true, session: meta });
    } catch {
      return json(res, 400, { ok: false, error: "invalid_session_id" });
    }
  }

  return json(res, 404, { ok: false, error: "not_found" });
}
