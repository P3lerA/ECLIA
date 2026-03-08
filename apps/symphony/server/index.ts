import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadEcliaConfig } from "@eclia/config";
import { makeAdapterLogger } from "@eclia/gateway-client/utils";

import { Registry } from "./registry.js";
import { StateStore } from "./state-store.js";
import { Conductor } from "./conductor.js";
import { handleSymphonyApi } from "./api.js";
import { buildInstrumentDef } from "./parse.js";

import type { ScopedLogger, TriggerSourceFactory, ActionStepFactory, InstrumentPreset } from "./types.js";

const log = makeAdapterLogger("symphony");

function makeInstrumentLogger(instrumentId: string): ScopedLogger {
  const prefix = `[symphony:${instrumentId}]`;
  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args)
  };
}

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/** Scan a directory for .ts/.js modules and dynamic-import each one. */
async function loadModules(dir: string): Promise<Array<Record<string, unknown>>> {
  const abs = path.resolve(__dirname, dir);
  let entries: string[];
  try { entries = fs.readdirSync(abs); } catch { return []; }
  const modules: Array<Record<string, unknown>> = [];
  for (const file of entries) {
    if (!/\.(ts|js)$/.test(file) || file.startsWith("_")) continue;
    try {
      const mod = await import(pathToFileURL(path.join(abs, file)).href);
      modules.push(mod);
    } catch (e: any) {
      log.warn(`failed to load ${dir}/${file}:`, String(e?.message ?? e));
    }
  }
  return modules;
}

function isTriggerFactory(v: unknown): v is TriggerSourceFactory {
  return v != null && typeof v === "object" && "kind" in v && "create" in v && !("execute" in v);
}

function isActionFactory(v: unknown): v is ActionStepFactory {
  return v != null && typeof v === "object" && "kind" in v && "create" in v;
}

function isPreset(v: unknown): v is InstrumentPreset {
  return v != null && typeof v === "object" && "presetId" in v && "triggerKinds" in v;
}

async function main() {
  const { rootDir, raw } = loadEcliaConfig(process.cwd());

  // ── Registry (auto-scan triggers/, actions/, presets/) ──

  const registry = new Registry();

  for (const mod of await loadModules("triggers")) {
    for (const exp of Object.values(mod)) {
      if (isTriggerFactory(exp)) {
        registry.registerTrigger(exp);
        log.info(`registered trigger: ${exp.kind}`);
      }
    }
  }

  for (const mod of await loadModules("actions")) {
    for (const exp of Object.values(mod)) {
      if (isActionFactory(exp)) {
        registry.registerAction(exp);
        log.info(`registered action: ${exp.kind}`);
      }
    }
  }

  // ── State store ──────────────────────────────────────────

  const stateStore = new StateStore(rootDir);
  await stateStore.init();

  // ── Conductor ────────────────────────────────────────────

  const conductor = new Conductor({
    registry,
    stateStore,
    makeLogger: makeInstrumentLogger
  });

  for (const mod of await loadModules("presets")) {
    for (const exp of Object.values(mod)) {
      if (isPreset(exp)) {
        conductor.registerPreset(exp);
        log.info(`registered preset: ${exp.presetId}`);
      }
    }
  }

  // ── Load instruments from config ─────────────────────────

  const symphonyCfg = (raw as any)?.symphony ?? {};
  const instrumentsCfg = Array.isArray(symphonyCfg.instruments) ? symphonyCfg.instruments : [];

  for (const entry of instrumentsCfg) {
    const id = String(entry?.id ?? "").trim();
    if (!id) {
      log.warn("skipping instrument with missing id");
      continue;
    }

    try {
      conductor.add(buildInstrumentDef({
        id,
        name: entry?.name,
        enabled: entry?.enabled,
        triggers: Array.isArray(entry?.triggers) ? entry.triggers : [],
        actions: Array.isArray(entry?.actions) ? entry.actions : []
      }));
    } catch (e: any) {
      log.warn(`skipping instrument "${id}":`, String(e?.message ?? e));
    }
  }

  // ── Start instruments ───────────────────────────────────

  const instruments = conductor.list();
  if (!instruments.length) {
    log.warn("no instruments configured — symphony idle");
  } else {
    log.info(`starting ${instruments.length} instrument(s)...`);
    await conductor.startAll();
  }

  // ── HTTP API ──────────────────────────────────────────

  const apiPort = Number(symphonyCfg.port) || 8789;
  const handler = handleSymphonyApi(conductor, rootDir);
  const server = http.createServer(handler);

  server.listen(apiPort, "127.0.0.1", () => {
    log.info(`api listening on http://127.0.0.1:${apiPort}`);
  });

  // Keep alive.
  await new Promise(() => {});
}

main().catch((e) => {
  log.error("startup failed:", String(e?.message ?? e));
  process.exit(1);
});
