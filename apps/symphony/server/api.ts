import type { Conductor } from "./conductor.js";
import type { InstrumentDef } from "./types.js";
import { json, readJson } from "@eclia/gateway-client/utils";
import { patchLocalToml } from "@eclia/config";
import type { InstrumentRuntime } from "./instrument-runtime.js";
import { buildInstrumentDef } from "./parse.js";

// ─── TOML persistence helpers ────────────────────────────────

function defToTomlEntry(def: InstrumentDef) {
  return {
    id: def.id,
    name: def.name,
    enabled: def.enabled,
    triggers: def.trigger.sources.map((s) => ({ kind: s.kind, config: s.config })),
    actions: def.actions.map((a) => ({ kind: a.kind, config: a.config }))
  };
}

function persistDef(rootDir: string, def: InstrumentDef): void {
  patchLocalToml(rootDir, (toml) => {
    if (!toml.symphony) toml.symphony = {};
    if (!Array.isArray(toml.symphony.instruments)) toml.symphony.instruments = [];
    toml.symphony.instruments = toml.symphony.instruments.filter(
      (e: any) => String(e?.id ?? "").trim() !== def.id
    );
    toml.symphony.instruments.push(defToTomlEntry(def));
  });
}

function removeDef(rootDir: string, id: string): void {
  patchLocalToml(rootDir, (toml) => {
    if (!Array.isArray(toml.symphony?.instruments)) return;
    toml.symphony.instruments = toml.symphony.instruments.filter(
      (e: any) => String(e?.id ?? "").trim() !== id
    );
  });
}

/**
 * Minimal HTTP API for the Symphony conductor.
 * Called by the gateway proxy at /api/symphony/*.
 *
 * Routes:
 *   GET  /instruments          — list all instruments (with full def)
 *   GET  /instruments/:id      — get one instrument
 *   POST /instruments          — create from preset or raw def
 *   PUT  /instruments/:id/enabled — toggle enabled + start/stop
 *   DELETE /instruments/:id    — stop + remove
 *   GET  /presets              — list available presets (with configSchema)
 *   GET  /triggers             — list trigger kinds (with configSchema)
 *   GET  /actions              — list action kinds (with configSchema)
 */
export function handleSymphonyApi(conductor: Conductor, rootDir: string) {
  return async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    const pathname = u.pathname;

    try {
      // GET /instruments
      if (pathname === "/instruments" && req.method === "GET") {
        const instruments = conductor.list().map((info) => {
          const rt = conductor.get(info.id);
          return rt ? serializeInstrument(rt, info) : { ...info, triggers: [], actions: [] };
        });
        return json(res, 200, { ok: true, instruments });
      }

      // GET /presets
      if (pathname === "/presets" && req.method === "GET") {
        const presets = conductor.listPresets().map((p) => ({
          presetId: p.presetId,
          name: p.name,
          description: p.description,
          triggerKinds: p.triggerKinds,
          actionKinds: p.actionKinds,
          configSchema: p.configSchema ?? []
        }));
        return json(res, 200, { ok: true, presets });
      }

      // GET /triggers
      if (pathname === "/triggers" && req.method === "GET") {
        return json(res, 200, { ok: true, triggers: conductor.registry.triggerSchemas() });
      }

      // GET /actions
      if (pathname === "/actions" && req.method === "GET") {
        return json(res, 200, { ok: true, actions: conductor.registry.actionSchemas() });
      }

      // POST /instruments — create from structured triggers + actions
      if (pathname === "/instruments" && req.method === "POST") {
        const body = await readJson(req);
        const instrumentId = typeof body?.instrumentId === "string" ? body.instrumentId.trim() : "";
        if (!instrumentId) return json(res, 400, { ok: false, error: "missing_instrument_id" });

        let def: InstrumentDef;
        try {
          def = buildInstrumentDef({
            id: instrumentId,
            name: body?.name,
            enabled: true,
            triggers: Array.isArray(body?.triggers) ? body.triggers : [],
            actions: Array.isArray(body?.actions) ? body.actions : []
          });
          conductor.add(def);
        } catch (e: any) {
          return json(res, 400, { ok: false, error: "create_failed", hint: String(e?.message ?? e) });
        }

        try { await conductor.start(instrumentId); } catch { /* best-effort */ }
        persistDef(rootDir, def);

        const rt = conductor.get(instrumentId);
        const instrument = rt ? serializeInstrument(rt) : null;
        return json(res, 200, { ok: true, instrument });
      }

      // PUT /instruments/:id/enabled
      const mEnabled = pathname.match(/^\/instruments\/([^/]+)\/enabled$/);
      if (mEnabled && req.method === "PUT") {
        const id = decodeURIComponent(mEnabled[1]);
        const rt = conductor.get(id);
        if (!rt) return json(res, 404, { ok: false, error: "not_found" });

        const body = await readJson(req);
        const enabled = Boolean(body?.enabled);

        rt.def.enabled = enabled;
        persistDef(rootDir, rt.def);

        if (enabled) {
          try { await conductor.start(id); } catch { /* best-effort */ }
        } else {
          try { await conductor.stop(id); } catch { /* best-effort */ }
        }

        return json(res, 200, { ok: true });
      }

      // PUT /instruments/:id — update config (trigger + actions)
      const mUpdate = pathname.match(/^\/instruments\/([^/]+)$/);
      if (mUpdate && req.method === "PUT") {
        const id = decodeURIComponent(mUpdate[1]);
        const rt = conductor.get(id);
        if (!rt) return json(res, 404, { ok: false, error: "not_found" });

        const body = await readJson(req);
        const rawTriggers = Array.isArray(body?.triggers) ? body.triggers : undefined;
        const rawActions = Array.isArray(body?.actions) ? body.actions : undefined;

        if (!rawTriggers && !rawActions) {
          return json(res, 400, { ok: false, error: "nothing_to_update" });
        }

        const oldDef = rt.def;
        try {
          const newDef = buildInstrumentDef({
            id: oldDef.id,
            name: oldDef.name,
            enabled: oldDef.enabled,
            triggers: rawTriggers ?? oldDef.trigger.sources,
            actions: rawActions ?? oldDef.actions
          });
          await conductor.update(id, newDef);
          persistDef(rootDir, newDef);
        } catch (e: any) {
          return json(res, 500, { ok: false, error: "update_failed", hint: String(e?.message ?? e) });
        }

        const updatedRt = conductor.get(id);
        const instrument = updatedRt ? serializeInstrument(updatedRt) : null;
        return json(res, 200, { ok: true, instrument });
      }

      // Match /instruments/:id for both GET and DELETE
      const mId = pathname.match(/^\/instruments\/([^/]+)$/);

      // DELETE /instruments/:id
      if (mId && req.method === "DELETE") {
        const id = decodeURIComponent(mId[1]);
        await conductor.remove(id);
        removeDef(rootDir, id);
        return json(res, 200, { ok: true });
      }

      // GET /instruments/:id
      if (mId && req.method === "GET") {
        const id = decodeURIComponent(mId[1]);
        const rt = conductor.get(id);
        if (!rt) return json(res, 404, { ok: false, error: "not_found" });
        return json(res, 200, { ok: true, instrument: serializeInstrument(rt) });
      }

      return json(res, 404, { ok: false, error: "not_found" });
    } catch (e: any) {
      return json(res, 500, { ok: false, error: "internal_error", hint: String(e?.message ?? e) });
    }
  };
}

// ─── Helpers ────────────────────────────────────────────────────

function serializeInstrument(rt: InstrumentRuntime, info?: { id: string; name: string; enabled: boolean; status: string }) {
  return { ...defToTomlEntry(rt.def), status: info?.status ?? rt.getStatus() };
}
