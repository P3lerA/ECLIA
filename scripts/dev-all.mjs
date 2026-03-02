import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_API_PORT = 8787;
const GATEWAY_READY_TIMEOUT_MS = 30_000;
const GATEWAY_READY_INTERVAL_MS = 300;

function readFileMaybe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function parseBoolLike(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return null;
}

function parsePortLike(v) {
  const raw = String(v ?? "").trim().replace(/^["']|["']$/g, "");
  const s = raw.replaceAll("_", "");
  if (!/^\d+$/.test(s)) return null;
  const port = Number(s);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return port;
}

function scanTomlKey(tomlText, targetSection, targetKey) {
  let section = "";
  for (const raw of String(tomlText ?? "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash).trim();
    if (!line) continue;

    const mSec = line.match(/^\[(.+?)\]\s*$/);
    if (mSec) {
      section = mSec[1].trim();
      continue;
    }

    if (section !== targetSection) continue;
    const m = line.match(new RegExp(`^${targetKey}\\s*=\\s*(.+?)\\s*$`));
    if (!m) continue;
    return m[1];
  }
  return null;
}

/**
 * Minimal TOML scanner for: [adapters.discord] enabled = true|false
 * This is intentionally tiny to avoid introducing a runtime dependency in dev scripts.
 */
function scanDiscordEnabled(tomlText) {
  const raw = scanTomlKey(tomlText, "adapters.discord", "enabled");
  return raw === null ? null : parseBoolLike(raw);
}

function scanTelegramEnabled(tomlText) {
  const raw = scanTomlKey(tomlText, "adapters.telegram", "enabled");
  return raw === null ? null : parseBoolLike(raw);
}

function scanEmailListenerEnabled(tomlText) {
  const raw = scanTomlKey(tomlText, "plugins.listener.email", "enabled");
  return raw === null ? null : parseBoolLike(raw);
}


function scanMemoryEnabled(tomlText) {
  const raw = scanTomlKey(tomlText, "memory", "enabled");
  return raw === null ? null : parseBoolLike(raw);
}


function scanApiPort(tomlText) {
  const raw = scanTomlKey(tomlText, "api", "port");
  return raw === null ? null : parsePortLike(raw);
}

function detectDiscordEnabled(rootDir) {
  const local = readFileMaybe(path.join(rootDir, "eclia.config.local.toml"));
  const base = readFileMaybe(path.join(rootDir, "eclia.config.toml"));

  const localVal = scanDiscordEnabled(local);
  const baseVal = scanDiscordEnabled(base);

  return (localVal ?? baseVal ?? false) === true;
}

function detectTelegramEnabled(rootDir) {
  const local = readFileMaybe(path.join(rootDir, "eclia.config.local.toml"));
  const base = readFileMaybe(path.join(rootDir, "eclia.config.toml"));

  const localVal = scanTelegramEnabled(local);
  const baseVal = scanTelegramEnabled(base);

  return (localVal ?? baseVal ?? false) === true;
}

function detectEmailListenerEnabled(rootDir) {
  const local = readFileMaybe(path.join(rootDir, "eclia.config.local.toml"));
  const base = readFileMaybe(path.join(rootDir, "eclia.config.toml"));

  const localVal = scanEmailListenerEnabled(local);
  const baseVal = scanEmailListenerEnabled(base);

  return (localVal ?? baseVal ?? false) === true;
}

function detectMemoryEnabled(rootDir) {
  const local = readFileMaybe(path.join(rootDir, "eclia.config.local.toml"));
  const base = readFileMaybe(path.join(rootDir, "eclia.config.toml"));

  const localVal = scanMemoryEnabled(local);
  const baseVal = scanMemoryEnabled(base);

  return (localVal ?? baseVal ?? false) === true;
}

function detectApiPort(rootDir) {
  const local = readFileMaybe(path.join(rootDir, "eclia.config.local.toml"));
  const base = readFileMaybe(path.join(rootDir, "eclia.config.toml"));

  const localVal = scanApiPort(local);
  const baseVal = scanApiPort(base);

  return localVal ?? baseVal ?? DEFAULT_API_PORT;
}

function pnpmCmd() {
  return "pnpm";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wirePrefix(stream, out, prefix) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx < 0) break;
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      out.write(`${prefix} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buf.trim().length) out.write(`${prefix} ${buf}\n`);
    buf = "";
  });
}

const TAG_PAD = 14; // keeps [API], [WEB], [DISCORD], [TELEGRAM], [LISTENER-EMAIL] aligned
function formatTag(tag) {
  return `[${String(tag ?? "").padEnd(TAG_PAD, " ")}]`;
}

function spawnDev(tag, args) {
  const child = spawn(pnpmCmd(), args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true
  });

  const prefix = formatTag(tag);
  if (child.stdout) wirePrefix(child.stdout, process.stdout, prefix);
  if (child.stderr) wirePrefix(child.stderr, process.stderr, prefix);

  return child;
}

const rootDir = process.cwd();
const discordEnabled = detectDiscordEnabled(rootDir);
const telegramEnabled = detectTelegramEnabled(rootDir);
const listenerEmailEnabled = detectEmailListenerEnabled(rootDir);
const memoryEnabled = detectMemoryEnabled(rootDir);
const apiPort = detectApiPort(rootDir);
const gatewayHealthUrl = `http://127.0.0.1:${apiPort}/api/health`;

console.log(`[DEV] root: ${rootDir}`);
console.log(`[DEV] api port: ${apiPort}`);
console.log(`[DEV] discord adapter: ${discordEnabled ? "enabled" : "disabled"}`);
console.log(`[DEV] telegram adapter: ${telegramEnabled ? "enabled" : "disabled"}`);
console.log(`[DEV] listener-email plugin: ${listenerEmailEnabled ? "enabled" : "disabled"}`);
console.log(`[DEV] memory service: ${memoryEnabled ? "enabled" : "disabled"}`);

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(code), 50);
}

function registerChild(tag, child) {
  children.push(child);

  child.on("error", (err) => {
    if (shuttingDown) return;
    console.error(`[DEV] ${tag} spawn failed: ${String(err?.message ?? err)}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
    console.error(`[DEV] ${tag} exited (code=${String(code)} signal=${String(signal)})`);
    shutdown(exitCode);
  });

  return child;
}

function spawnRegistered(tag, args) {
  return registerChild(tag, spawnDev(tag, args));
}

async function probeGatewayHealth(timeoutMs = 1_500) {
  let timer = null;
  try {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(gatewayHealthUrl, { method: "GET", signal: ctrl.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForGatewayReady(apiChild) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < GATEWAY_READY_TIMEOUT_MS) {
    if (shuttingDown) return false;
    if (apiChild.exitCode !== null || apiChild.killed) {
      throw new Error("gateway process exited before it became ready");
    }

    let timer = null;
    try {
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), 1_500);
      const resp = await fetch(gatewayHealthUrl, { method: "GET", signal: ctrl.signal });
      if (resp.ok) return true;
    } catch {
      // gateway is not ready yet
    } finally {
      if (timer) clearTimeout(timer);
    }

    await sleep(GATEWAY_READY_INTERVAL_MS);
  }

  throw new Error(`gateway health check timed out after ${GATEWAY_READY_TIMEOUT_MS}ms (${gatewayHealthUrl})`);
}

async function main() {
  const gatewayAlreadyUp = await probeGatewayHealth();
  if (gatewayAlreadyUp) {
    console.log(`[DEV] gateway already healthy at ${gatewayHealthUrl}; reusing existing process`);
  } else {
    const apiChild = spawnRegistered("API", ["-C", "apps/gateway", "dev"]);
    console.log(`[DEV] waiting for gateway: ${gatewayHealthUrl}`);
    await waitForGatewayReady(apiChild);
    if (shuttingDown) return;
  }

  if (memoryEnabled) {
    console.log("[DEV] gateway ready; starting MEMORY");
    spawnRegistered("MEMORY", ["-C", "apps/memory", "dev"]);
  }

  console.log("[DEV] gateway ready; starting WEB");
  spawnRegistered("WEB", ["-C", "apps/web-console", "dev"]);

  if (discordEnabled) {
    console.log("[DEV] gateway ready; starting DISCORD");
    spawnRegistered("DISCORD", ["-C", "apps/adapter/discord", "dev"]);
  }

  if (telegramEnabled) {
    console.log("[DEV] gateway ready; starting TELEGRAM");
    spawnRegistered("TELEGRAM", ["-C", "apps/adapter/telegram", "dev"]);
  }

  if (listenerEmailEnabled) {
    console.log("[DEV] gateway ready; starting LISTENER-EMAIL");
    spawnRegistered("LISTENER-EMAIL", ["-C", "plugins/listener/email", "dev"]);
  }
}

main().catch((err) => {
  if (shuttingDown) return;
  console.error(`[DEV] startup failed: ${String(err?.message ?? err)}`);
  shutdown(1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
