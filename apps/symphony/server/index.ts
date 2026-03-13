import http from "node:http";

import { findProjectRoot, loadEcliaConfig } from "@eclia/config";
import { guessGatewayUrl } from "@eclia/gateway-client";

import { Registry } from "./registry.js";
import { StateStore } from "./state-store.js";
import { OpusStore } from "./opus-store.js";
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
  await registerBuiltins(registry);
  log.info(`registered ${registry.schemas().length} node kind(s)`);

  // ── Stores ───────────────────────────────────────────────
  const stateStore = new StateStore(rootDir);
  await stateStore.init();

  const opusStore = new OpusStore(rootDir);
  await opusStore.init();

  // ── Conductor ────────────────────────────────────────────
  const gatewayUrl = guessGatewayUrl();
  log.info(`gateway URL: ${gatewayUrl}`);

  const evalLog = makeLogger("eval");
  const conductor = new Conductor({
    registry,
    gatewayUrl,
    stateStore,
    opusStore,
    makeLogger,
    onEvaluationComplete(rec) {
      const status = rec.error ? `error: ${rec.error}` : `ok`;
      evalLog.info(
        `opus=${rec.opusId} src=${rec.sourceId} ran=${rec.nodesRun.length} halted=${rec.nodesHalted.length} ${rec.durationMs}ms [${status}]`
      );
    },
  });
  await conductor.bootstrap();
  log.info(`loaded ${conductor.list().length} opus definition(s)`);

  // ── HTTP server ──────────────────────────────────────────
  const handler = handleSymphonyApi(conductor);
  const { config } = loadEcliaConfig(rootDir);
  const host = String(config.symphony.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = Number(process.env.SYMPHONY_PORT) || config.symphony.port || DEFAULT_PORT;

  const server = http.createServer(handler);
  server.listen(port, host, () => {
    log.info(`listening on http://${host}:${port}`);
  });

  // Graceful shutdown.
  const shutdown = async () => {
    log.info("shutting down...");
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
