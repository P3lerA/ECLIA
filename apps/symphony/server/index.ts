import http from "node:http";

import { findProjectRoot } from "@eclia/config";

import { Registry } from "./registry.js";
import { StateStore } from "./state-store.js";
import { FlowStore } from "./flow-store.js";
import { Conductor } from "./conductor.js";
import { handleSymphonyApi } from "./api.js";
import { registerBuiltins } from "./nodes/index.js";
import type { ScopedLogger } from "./types.js";

const DEFAULT_PORT = 8800;

function makeLogger(scope: string): ScopedLogger {
  const tag = `[symphony:${scope}]`;
  return {
    info: (...args: unknown[]) => console.log(tag, ...args),
    warn: (...args: unknown[]) => console.warn(tag, ...args),
    error: (...args: unknown[]) => console.error(tag, ...args)
  };
}

async function main() {
  const rootDir = findProjectRoot(process.cwd());
  const log = makeLogger("main");

  // ── Registry ─────────────────────────────────────────────
  const registry = new Registry();
  registerBuiltins(registry);
  log.info(`registered ${registry.schemas().length} node kind(s)`);

  // ── Stores ───────────────────────────────────────────────
  const stateStore = new StateStore(rootDir);
  await stateStore.init();

  const flowStore = new FlowStore(rootDir);
  await flowStore.init();

  // ── Conductor ────────────────────────────────────────────
  const conductor = new Conductor({
    registry,
    stateStore,
    flowStore,
    makeLogger
  });
  await conductor.bootstrap();
  log.info(`loaded ${conductor.list().length} flow(s)`);

  // ── HTTP server ──────────────────────────────────────────
  const handler = handleSymphonyApi(conductor);
  const port = Number(process.env.SYMPHONY_PORT) || DEFAULT_PORT;

  const server = http.createServer(handler);
  server.listen(port, "127.0.0.1", () => {
    log.info(`listening on http://127.0.0.1:${port}`);
  });

  // Graceful shutdown.
  const shutdown = async () => {
    log.info("shutting down…");
    await conductor.stopAll();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[symphony] fatal:", e);
  process.exit(1);
});
