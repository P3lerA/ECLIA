import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_API_PORT = 8787;
const GATEWAY_READY_TIMEOUT_MS = 30_000;
const GATEWAY_POLL_MS = 300;
const TAG_PAD = 14;

// ── TOML scanning ────────────────────────────────────────────────
// Intentionally minimal to avoid runtime dependencies in dev scripts.

function readFileMaybe(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

function scanTomlKey(toml, section, key) {
  let cur = "";
  for (let line of String(toml ?? "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash).trim();
    if (!line) continue;

    const sec = line.match(/^\[(.+?)\]\s*$/);
    if (sec) { cur = sec[1].trim(); continue; }
    if (cur !== section) continue;

    const m = line.match(new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`));
    if (m) return m[1];
  }
  return null;
}

/** Read a key from base + local TOML (local wins). */
function readTomlValue(rootDir, section, key) {
  const base = readFileMaybe(path.join(rootDir, "eclia.config.toml"));
  const local = readFileMaybe(path.join(rootDir, "eclia.config.local.toml"));
  return scanTomlKey(local, section, key) ?? scanTomlKey(base, section, key);
}

function toBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return null;
}

function toPort(v) {
  const s = String(v ?? "").trim().replace(/^["']|["']$/g, "").replaceAll("_", "");
  if (!/^\d+$/.test(s)) return null;
  const port = Number(s);
  return (port > 0 && port <= 65535) ? port : null;
}

function detectEnabled(rootDir, section) {
  return toBool(readTomlValue(rootDir, section, "enabled")) ?? false;
}

function detectPort(rootDir, section, fallback) {
  return toPort(readTomlValue(rootDir, section, "port")) ?? fallback;
}

// ── Process management ───────────────────────────────────────────

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) { try { c.kill(); } catch {} }
  setTimeout(() => process.exit(code), 50);
}

function wirePrefix(stream, out, prefix) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      out.write(`${prefix} ${buf.slice(0, idx)}\n`);
      buf = buf.slice(idx + 1);
    }
  });
  stream.on("end", () => {
    if (buf.trim()) out.write(`${prefix} ${buf}\n`);
  });
}

function spawnService(tag, args) {
  const child = spawn("pnpm", args, {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true
  });

  const prefix = `[${tag.padEnd(TAG_PAD)}]`;
  if (child.stdout) wirePrefix(child.stdout, process.stdout, prefix);
  if (child.stderr) wirePrefix(child.stderr, process.stderr, prefix);

  children.push(child);
  child.on("error", (err) => {
    if (shuttingDown) return;
    console.error(`[DEV] ${tag} spawn failed: ${String(err?.message ?? err)}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[DEV] ${tag} exited (code=${code} signal=${signal})`);
    shutdown(typeof code === "number" ? code : 1);
  });

  return child;
}

// ── Gateway readiness ────────────────────────────────────────────

async function probeHealth(url, timeoutMs = 1_500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    return resp.ok;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

async function waitForGateway(apiChild, healthUrl) {
  const start = Date.now();
  while (Date.now() - start < GATEWAY_READY_TIMEOUT_MS) {
    if (shuttingDown) return;
    if (apiChild.exitCode !== null || apiChild.killed) {
      throw new Error("gateway exited before becoming ready");
    }
    if (await probeHealth(healthUrl)) return;
    await new Promise((r) => setTimeout(r, GATEWAY_POLL_MS));
  }
  throw new Error(`gateway health timed out after ${GATEWAY_READY_TIMEOUT_MS}ms (${healthUrl})`);
}

// ── Main ─────────────────────────────────────────────────────────

const rootDir = process.cwd();
const apiPort = detectPort(rootDir, "api", DEFAULT_API_PORT);
const healthUrl = `http://127.0.0.1:${apiPort}/api/health`;

const services = {
  memory:   detectEnabled(rootDir, "memory"),
  symphony: detectEnabled(rootDir, "symphony"),
  discord:  detectEnabled(rootDir, "adapters.discord"),
  telegram: detectEnabled(rootDir, "adapters.telegram"),
};

async function main() {
  console.log(`[DEV] root: ${rootDir}`);
  console.log(`[DEV] api port: ${apiPort}`);
  for (const [name, on] of Object.entries(services)) {
    console.log(`[DEV] ${name}: ${on ? "enabled" : "disabled"}`);
  }

  // 1. Pre-build shared packages (must complete before any service imports them).
  console.log("[DEV] building shared packages...");
  execSync("pnpm build:shared", { cwd: rootDir, stdio: "inherit" });

  // 2. Start or reuse gateway.
  if (await probeHealth(healthUrl)) {
    console.log(`[DEV] gateway already healthy; reusing existing process`);
  } else {
    const apiChild = spawnService("API", ["-C", "apps/gateway", "dev"]);
    console.log(`[DEV] waiting for gateway...`);
    await waitForGateway(apiChild, healthUrl);
    if (shuttingDown) return;
  }

  // 3. Start remaining services.
  console.log("[DEV] gateway ready; launching services");

  if (services.memory)   spawnService("MEMORY",   ["-C", "apps/memory", "dev"]);
  if (services.symphony) spawnService("SYMPHONY", ["-C", "apps/symphony", "dev"]);
  spawnService("WEB",      ["-C", "apps/web-console", "dev"]);
  if (services.discord)  spawnService("DISCORD",  ["-C", "apps/adapter/discord", "dev"]);
  if (services.telegram) spawnService("TELEGRAM", ["-C", "apps/adapter/telegram", "dev"]);
}

main().catch((err) => {
  if (!shuttingDown) {
    console.error(`[DEV] startup failed: ${String(err?.message ?? err)}`);
    shutdown(1);
  }
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
