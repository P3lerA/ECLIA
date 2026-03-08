import type { Conductor } from "./conductor.js";
import type { FlowDef } from "./types.js";
import type { FlowRuntime } from "./flow-runtime.js";
import { json, readJson } from "@eclia/gateway-client/utils";
import { FlowValidationError } from "./graph.js";

/**
 * HTTP API handler for Symphony.
 *
 * Routes:
 *   GET    /nodes                — list registered node kinds (with ports + config schema)
 *   GET    /flows                — list all flows
 *   GET    /flows/:id            — get one flow (full def + status)
 *   POST   /flows                — create a new flow
 *   PUT    /flows/:id            — update a flow definition
 *   PUT    /flows/:id/enabled    — toggle enabled + start/stop
 *   DELETE /flows/:id            — stop + remove
 *   POST   /flows/validate       — dry-run validation without saving
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

      // ── List flows ───────────────────────────────────────
      if (p === "/flows" && req.method === "GET") {
        const flows = conductor.list().map((info) => {
          const rt = conductor.get(info.id);
          return { ...info, def: rt?.def ?? null };
        });
        return json(res, 200, { ok: true, flows });
      }

      // ── Create flow ──────────────────────────────────────
      if (p === "/flows" && req.method === "POST") {
        const body = await readJson(req);
        const def = parseFlowDef(body);
        if (!def) return json(res, 400, { ok: false, error: "invalid_flow_def" });

        await conductor.upsert(def);
        return json(res, 201, { ok: true, flow: serializeFlow(conductor.get(def.id)) });
      }

      // ── Validate (dry run) ───────────────────────────────
      if (p === "/flows/validate" && req.method === "POST") {
        const body = await readJson(req);
        const def = parseFlowDef(body);
        if (!def) return json(res, 400, { ok: false, error: "invalid_flow_def" });
        const errors = conductor.validate(def);
        return json(res, 200, { ok: true, valid: errors.length === 0, errors });
      }

      // ── Single flow routes ───────────────────────────────

      // PUT /flows/:id/enabled
      const mEnabled = p.match(/^\/flows\/([^/]+)\/enabled$/);
      if (mEnabled && req.method === "PUT") {
        const id = decodeURIComponent(mEnabled[1]);
        if (!conductor.get(id)) return json(res, 404, { ok: false, error: "not_found" });

        const body = await readJson(req);
        await conductor.setEnabled(id, Boolean(body?.enabled));
        return json(res, 200, { ok: true });
      }

      const mId = p.match(/^\/flows\/([^/]+)$/);
      if (!mId) return json(res, 404, { ok: false, error: "not_found" });
      const id = decodeURIComponent(mId[1]);

      // GET /flows/:id
      if (req.method === "GET") {
        const rt = conductor.get(id);
        if (!rt) return json(res, 404, { ok: false, error: "not_found" });
        return json(res, 200, { ok: true, flow: serializeFlow(rt) });
      }

      // PUT /flows/:id
      if (req.method === "PUT") {
        if (!conductor.get(id)) return json(res, 404, { ok: false, error: "not_found" });

        const body = await readJson(req);
        const def = parseFlowDef(body);
        if (!def || def.id !== id) return json(res, 400, { ok: false, error: "invalid_flow_def" });

        await conductor.upsert(def);
        return json(res, 200, { ok: true, flow: serializeFlow(conductor.get(id)) });
      }

      // DELETE /flows/:id
      if (req.method === "DELETE") {
        await conductor.remove(id);
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { ok: false, error: "not_found" });
    } catch (e: any) {
      if (e instanceof FlowValidationError) {
        return json(res, 400, { ok: false, error: "validation_failed", errors: e.errors });
      }
      return json(res, 500, { ok: false, error: "internal_error", hint: String(e?.message ?? e) });
    }
  };
}

// ─── Helpers ────────────────────────────────────────────────

function parseFlowDef(body: any): FlowDef | null {
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

function serializeFlow(rt: FlowRuntime | undefined) {
  if (!rt) return null;
  return { ...rt.def, status: rt.getStatus() };
}
