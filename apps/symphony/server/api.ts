import type { Conductor } from "./conductor.js";
import type { OpusDef } from "./types.js";
import type { OpusRuntime } from "./opus-runtime.js";
import { json, readJson } from "@eclia/gateway-client/utils";
import { OpusValidationError } from "./graph.js";

/**
 * HTTP API handler for Symphony.
 *
 * Routes:
 *   GET    /nodes                — list registered node kinds (with ports + config schema)
 *   GET    /opus                 — list all opus definitions
 *   GET    /opus/:id             — get one opus (full def + status)
 *   POST   /opus                 — create a new opus
 *   PUT    /opus/:id             — update an opus definition
 *   PUT    /opus/:id/enabled     — toggle enabled + start/stop
 *   DELETE /opus/:id             — stop + remove
 *   POST   /opus/validate        — dry-run validation without saving
 */
export function handleSymphonyApi(conductor: Conductor) {
  return async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    const p = u.pathname;

    try {
      // ── Node registry ────────────────────────────────────
      if (p === "/nodes" && req.method === "GET") {
        return json(res, 200, { ok: true, nodes: conductor.registry.schemas() });
      }

      // ── List opus ─────────────────────────────────────────
      if (p === "/opus" && req.method === "GET") {
        return json(res, 200, { ok: true, opus: conductor.list() });
      }

      // ── Create opus ───────────────────────────────────────
      if (p === "/opus" && req.method === "POST") {
        const body = await readJson(req);
        const def = parseOpusDef(body);
        if (!def) return json(res, 400, { ok: false, error: "invalid_opus_def" });

        await conductor.upsert(def);
        return json(res, 201, { ok: true, opus: serializeOpus(conductor.get(def.id)) });
      }

      // ── Validate (dry run) ───────────────────────────────
      if (p === "/opus/validate" && req.method === "POST") {
        const body = await readJson(req);
        const def = parseOpusDef(body);
        if (!def) return json(res, 400, { ok: false, error: "invalid_opus_def" });
        const errors = conductor.validate(def);
        return json(res, 200, { ok: true, valid: errors.length === 0, errors });
      }

      // ── Single opus routes ────────────────────────────────

      // POST /opus/:id/trigger/:nodeId — fire a manual-trigger source
      const mTrigger = p.match(/^\/opus\/([^/]+)\/trigger\/([^/]+)$/);
      if (mTrigger && req.method === "POST") {
        const id = decodeURIComponent(mTrigger[1]);
        const nodeId = decodeURIComponent(mTrigger[2]);
        const rt = conductor.get(id);
        if (!rt) return json(res, 404, { ok: false, error: "not_found" });
        if (rt.getStatus() !== "running") {
          return json(res, 400, { ok: false, error: "opus_not_running", hint: "Enable and start the opus first" });
        }

        const body = await readJson(req).catch(() => ({}));
        rt.triggerNode(nodeId, (body as any)?.payload);
        return json(res, 200, { ok: true });
      }

      // POST /opus/:id/reload — tear down and re-instantiate runtime
      const mReload = p.match(/^\/opus\/([^/]+)\/reload$/);
      if (mReload && req.method === "POST") {
        const id = decodeURIComponent(mReload[1]);
        const rt = conductor.get(id);
        if (!rt) return json(res, 404, { ok: false, error: "not_found" });

        const errors = conductor.validate(rt.def);
        if (errors.length) throw new OpusValidationError(errors);

        await conductor.reload(id);
        return json(res, 200, { ok: true, opus: serializeOpus(conductor.get(id)) });
      }

      // PUT /opus/:id/enabled
      const mEnabled = p.match(/^\/opus\/([^/]+)\/enabled$/);
      if (mEnabled && req.method === "PUT") {
        const id = decodeURIComponent(mEnabled[1]);
        if (!conductor.get(id)) return json(res, 404, { ok: false, error: "not_found" });

        const body = await readJson(req);
        await conductor.setEnabled(id, Boolean(body?.enabled));
        return json(res, 200, { ok: true, opus: serializeOpus(conductor.get(id)) });
      }

      const mId = p.match(/^\/opus\/([^/]+)$/);
      if (!mId) return json(res, 404, { ok: false, error: "not_found" });
      const id = decodeURIComponent(mId[1]);

      // GET /opus/:id
      if (req.method === "GET") {
        const rt = conductor.get(id);
        if (rt) return json(res, 200, { ok: true, opus: serializeOpus(rt) });
        const failed = conductor.getFailedDef(id);
        if (failed) return json(res, 200, { ok: true, opus: { ...failed, status: "error" as const } });
        return json(res, 404, { ok: false, error: "not_found" });
      }

      // PUT /opus/:id — save without restarting runtime (no validation — draft save)
      if (req.method === "PUT") {
        const body = await readJson(req);
        const def = parseOpusDef(body);
        if (!def || def.id !== id) return json(res, 400, { ok: false, error: "invalid_opus_def" });

        const existed = !!conductor.get(id) || !!conductor.getFailedDef(id);
        await conductor.save(def);
        const rt = conductor.get(id);
        const opus = rt ? serializeOpus(rt) : { ...def, status: "error" as const };
        return json(res, existed ? 200 : 201, { ok: true, opus });
      }

      // DELETE /opus/:id
      if (req.method === "DELETE") {
        await conductor.remove(id);
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { ok: false, error: "not_found" });
    } catch (e: any) {
      if (e instanceof OpusValidationError) {
        return json(res, 400, { ok: false, error: "validation_failed", errors: e.errors });
      }
      return json(res, 500, { ok: false, error: "internal_error", hint: String(e?.message ?? e) });
    }
  };
}

// ─── Helpers ────────────────────────────────────────────────

function parseOpusDef(body: any): OpusDef | null {
  if (!body || typeof body !== "object") return null;
  if (typeof body.id !== "string" || !body.id.trim()) return null;
  return {
    id: body.id.trim(),
    name: typeof body.name === "string" ? body.name.trim() : body.id.trim(),
    enabled: body.enabled !== false,
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    links: Array.isArray(body.links) ? body.links : [],
    ui: body.ui ?? undefined
  };
}

function serializeOpus(rt: OpusRuntime | undefined) {
  if (!rt) return null;
  return { ...rt.def, status: rt.getStatus() };
}
