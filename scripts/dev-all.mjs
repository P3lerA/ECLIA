import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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

/**
 * Minimal TOML scanner for: [adapters.discord] enabled = true|false
 * This is intentionally tiny to avoid introducing a runtime dependency in dev scripts.
 */
function scanDiscordEnabled(tomlText) {
  let section = "";
  for (const raw of String(tomlText ?? "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;

    // strip inline comments (best-effort; good enough for our simple keys)
    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash).trim();
    if (!line) continue;

    const mSec = line.match(/^\[(.+?)\]\s*$/);
    if (mSec) {
      section = mSec[1].trim();
      continue;
    }

    if (section !== "adapters.discord") continue;

    const m = line.match(/^enabled\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    return parseBoolLike(m[1]);
  }
  return null;
}

function detectDiscordEnabled(rootDir) {
  const local = readFileMaybe(path.join(rootDir, "eclia.config.local.toml"));
  const base = readFileMaybe(path.join(rootDir, "eclia.config.toml"));

  const localVal = scanDiscordEnabled(local);
  const baseVal = scanDiscordEnabled(base);

  return (localVal ?? baseVal ?? false) === true;
}

 function pnpmCmd() {  return "pnpm"; }

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

function spawnDev(tag, args) {
  const child = spawn(pnpmCmd(), args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true
  });

  const prefix = `[${tag}]`;
  if (child.stdout) wirePrefix(child.stdout, process.stdout, prefix);
  if (child.stderr) wirePrefix(child.stderr, process.stderr, prefix);

  return child;
}

const rootDir = process.cwd();
const discordEnabled = detectDiscordEnabled(rootDir);

console.log(`[DEV] root: ${rootDir}`);
console.log(`[DEV] discord adapter: ${discordEnabled ? "enabled" : "disabled"}`);

const children = [];
children.push(spawnDev("WEB", ["-C", "apps/web-console", "dev"]));
children.push(spawnDev("API", ["-C", "apps/gateway", "dev"]));
if (discordEnabled) {
  children.push(spawnDev("DISCORD", ["-C", "apps/adapter/discord", "dev"]));
}

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
  // Allow stdio flush.
  setTimeout(() => process.exit(code), 50);
}

for (const c of children) {
  c.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
    shutdown(exitCode);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
