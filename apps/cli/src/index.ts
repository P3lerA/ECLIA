#!/usr/bin/env node
import { spawn } from "node:child_process";
import { ensureLocalConfig, loadEcliaConfig, resolveRepoRoot } from "./ecliaConfig";

function printHelp(): void {
  // Keep it short; this is a dev-focused CLI for now.
  console.log(`
ECLIA CLI (dev)

Usage:
  eclia dev                 Start web-console + gateway (dev)
  eclia web                 Start web-console (dev)
  eclia gateway             Start gateway (dev)
  eclia config init         Create eclia.config.local.toml if missing
  eclia doctor              Basic environment/config checks
  eclia -h | --help         Show help
`.trim());
}

function isWin(): boolean {
  return process.platform === "win32";
}

function run(cmd: string, args: string[], label?: string) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: isWin(),
    env: process.env,
  });

  child.on("exit", (code) => {
    if (typeof code === "number" && code !== 0) {
      console.error(`${label ?? cmd} exited with code ${code}`);
    }
  });

  return child;
}

function devAll() {
  const repoRoot = resolveRepoRoot();
  ensureLocalConfig(repoRoot);

  // Start both processes.
  const web = run("pnpm", ["-C", "apps/web-console", "dev"], "WEB");
  const api = run("pnpm", ["-C", "apps/gateway", "dev"], "GATEWAY");

  // Best-effort cleanup.
  const stop = () => {
    try { web.kill("SIGINT"); } catch {}
    try { api.kill("SIGINT"); } catch {}
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function doctor() {
  const repoRoot = resolveRepoRoot();
  ensureLocalConfig(repoRoot);
  const cfg = loadEcliaConfig(repoRoot);

  const host = cfg.console?.host ?? "127.0.0.1";
  const port = cfg.console?.port ?? "(default)";
  const apiPort = cfg.api?.port ?? 8787;

  console.log(`repoRoot: ${repoRoot}`);
  console.log(`console:  ${host}:${port}`);
  console.log(`gateway:  localhost:${apiPort}`);

  const hasKey = Boolean(cfg.inference?.openai_compat?.api_key);
  console.log(`openai_compat.api_key: ${hasKey ? "configured" : "missing"}`);
}

const argv = process.argv.slice(2);

if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
  printHelp();
  process.exit(0);
}

const cmd = argv[0];

switch (cmd) {
  case "dev":
    devAll();
    break;

  case "web": {
    const repoRoot = resolveRepoRoot();
    ensureLocalConfig(repoRoot);
    run("pnpm", ["-C", "apps/web-console", "dev"], "WEB");
    break;
  }

  case "gateway": {
    const repoRoot = resolveRepoRoot();
    ensureLocalConfig(repoRoot);
    run("pnpm", ["-C", "apps/gateway", "dev"], "GATEWAY");
    break;
  }

  case "config": {
    const sub = argv[1];
    if (sub === "init") {
      const repoRoot = resolveRepoRoot();
      ensureLocalConfig(repoRoot);
      console.log("ok: eclia.config.local.toml ensured");
      process.exit(0);
    }
    printHelp();
    process.exit(1);
  }

  case "doctor":
    doctor();
    break;

  default:
    console.error(`Unknown command: ${cmd}`);
    printHelp();
    process.exit(1);
}
