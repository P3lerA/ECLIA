import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal MCP stdio server that exposes a single tool: `exec`.
 *
 * Transport requirements (stdio):
 * - Read newline-delimited JSON-RPC messages from stdin
 * - Write ONLY newline-delimited JSON-RPC messages to stdout
 * - Write logs to stderr
 */

const PROTOCOL_VERSION = "2025-06-18";

// --- JSON-RPC helpers -------------------------------------------------------

function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** @param {any} obj */
function writeMessage(obj) {
  // MUST NOT contain embedded newlines as per MCP stdio transport.
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/**
 * Serialize writes to stdout so concurrent tool calls can't interleave and
 * corrupt the JSON-RPC stream.
 */
let writeChain = Promise.resolve();
function writeMessageSerial(obj) {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve) => {
        writeMessage(obj);
        resolve();
      })
  );
  return writeChain;
}

function jsonRpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id, error: err };
}

function nowMs() {
  return Date.now();
}

// --- Exec implementation ----------------------------------------------------

function clampInt(v, fallback, min, max) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function toStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

function normalizeEnv(extra) {
  if (!isRecord(extra)) return {};
  const out = {};
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Best-effort arg normalization.
 * - Defaults match gateway's previous in-process exec.
 */
function parseExecArgs(raw) {
  const obj = isRecord(raw) ? raw : {};
  const cmd = typeof obj.cmd === "string" && obj.cmd.trim() ? obj.cmd.trim() : undefined;
  const command = typeof obj.command === "string" && obj.command.trim() ? obj.command.trim() : undefined;

  return {
    cmd,
    args: toStringArray(obj.args),
    command,
    cwd: typeof obj.cwd === "string" && obj.cwd.trim() ? obj.cwd.trim() : undefined,
    timeoutMs: clampInt(obj.timeoutMs, 60_000, 1_000, 60 * 60_000),
    maxStdoutBytes: clampInt(obj.maxStdoutBytes, 200_000, 1_000, 20_000_000),
    maxStderrBytes: clampInt(obj.maxStderrBytes, 200_000, 1_000, 20_000_000),
    env: normalizeEnv(obj.env)
  };
}

function resolveCwd(projectRoot, cwdArg) {
  const root = path.resolve(projectRoot);
  const cwdRaw = String(cwdArg ?? "").trim();
  if (!cwdRaw || cwdRaw === ".") return { ok: true, cwd: root };

  // Absolute path escape hatch.
  if (path.isAbsolute(cwdRaw)) return { ok: true, cwd: path.resolve(cwdRaw) };

  const next = path.resolve(root, cwdRaw);
  // Prevent "../../" escaping by accident.
  const rel = path.relative(root, next);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, error: `cwd escapes projectRoot: ${cwdRaw}` };
  }
  return { ok: true, cwd: next };
}

function withHomebrewPath(env) {
  // Apple Silicon default Homebrew prefix.
  const brewBins = ["/opt/homebrew/bin", "/opt/homebrew/sbin"];

  const key = Object.prototype.hasOwnProperty.call(env, "PATH")
    ? "PATH"
    : Object.prototype.hasOwnProperty.call(env, "Path")
      ? "Path"
      : "PATH";

  const current = String(env[key] ?? "");
  const delim = path.delimiter;
  const parts = current.split(delim).filter(Boolean);

  const nextParts = [...brewBins.filter((p) => !parts.includes(p)), ...parts];
  return { ...env, [key]: nextParts.join(delim) };
}


function defaultShell() {
  if (process.platform === "win32") {
    const file = process.env.ComSpec || "cmd.exe";
    return { file, argsPrefix: ["/d", "/s", "/c"] };
  }

  if (process.platform === "darwin") {
    return { file: "/bin/zsh", argsPrefix: ["-lc"] };
  }

  const file = process.env.SHELL && process.env.SHELL.trim() ? process.env.SHELL : "/bin/bash";
  return { file, argsPrefix: ["-lc"] };
}

function killTree(child) {
  try {
    if (process.platform !== "win32" && child.pid) {
      // When spawned with { detached: true }, the child becomes its own process group.
      // A negative PID targets the entire group.
      process.kill(-child.pid, "SIGKILL");
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    // ignore
  }
}


async function runExecTool(rawArgs, signal) {
  const t0 = nowMs();
  const args = parseExecArgs(rawArgs);
  const projectRoot = process.cwd();

  const cwdRes = resolveCwd(projectRoot, args.cwd);
  if (!cwdRes.ok) {
    return {
      type: "exec_result",
      ok: false,
      error: { code: "bad_cwd", message: cwdRes.error },
      cwd: projectRoot,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: undefined,
      truncated: { stdout: false, stderr: false },
      durationMs: nowMs() - t0,
      timedOut: false,
      aborted: false
    };
  }

  const cwd = cwdRes.cwd;

  const timeoutMs = args.timeoutMs ?? 60_000;
  const maxOut = args.maxStdoutBytes ?? 200_000;
  const maxErr = args.maxStderrBytes ?? 200_000;

  // Keep the original request for transparency/debugging.
  const requested = { cmd: args.cmd, args: args.args ?? [], command: args.command };

  // Decide what we actually execute.
  let usedShell = false;
  let commandStr = args.command;

  let effectiveFile = null;
  let effectiveArgs = [];

  if (commandStr) {
    usedShell = true;
  } else if (args.cmd) {
    effectiveFile = args.cmd;
    effectiveArgs = args.args ?? [];

    // Some models send a whole command line in `cmd` (e.g. "ls -la").
    // If `args` is empty and `cmd` contains whitespace, treat it as a shell command,
    // unless it points to an existing executable path (which may contain spaces).
    if (!effectiveArgs.length && /\s/.test(effectiveFile)) {
      const candidatePath = path.isAbsolute(effectiveFile) ? effectiveFile : path.resolve(cwd, effectiveFile);
      if (!fs.existsSync(candidatePath)) {
        usedShell = true;
        commandStr = effectiveFile;
      }
    }
  }

  if (usedShell) {
    if (!commandStr) {
      return {
        type: "exec_result",
        ok: false,
        error: { code: "missing_command", message: "Provide 'cmd' (preferred) or 'command'." },
        cwd,
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: undefined,
        truncated: { stdout: false, stderr: false },
        durationMs: nowMs() - t0,
        timedOut: false,
        aborted: false
      };
    }

    const sh = defaultShell();
    effectiveFile = sh.file;
    effectiveArgs = [...sh.argsPrefix, commandStr];
  }

  if (!effectiveFile) {
    return {
      type: "exec_result",
      ok: false,
      error: { code: "missing_command", message: "Provide 'cmd' (preferred) or 'command'." },
      cwd,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: undefined,
      truncated: { stdout: false, stderr: false },
      durationMs: nowMs() - t0,
      timedOut: false,
      aborted: false
    };
  }

  const env = withHomebrewPath({ ...process.env, ...args.env });

  let child;
  try {
    child = spawn(effectiveFile, effectiveArgs, {
      cwd,
      shell: false,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
  } catch (e) {
    return {
      type: "exec_result",
      ok: false,
      error: { code: "spawn_failed", message: String(e?.message ?? e) },
      cwd,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: undefined,
      truncated: { stdout: false, stderr: false },
      durationMs: nowMs() - t0,
      timedOut: false,
      aborted: false
    };
  }

  let stdout = "";
  let stderr = "";
  let outTrunc = false;
  let errTrunc = false;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  child.stdout?.on("data", (chunk) => {
    if (outTrunc) return;
    const next = stdout + chunk;
    if (Buffer.byteLength(next, "utf8") > maxOut) {
      // Truncate to maxOut bytes.
      const buf = Buffer.from(next, "utf8");
      stdout = buf.subarray(0, maxOut).toString("utf8");
      outTrunc = true;
    } else {
      stdout = next;
    }
  });

  child.stderr?.on("data", (chunk) => {
    if (errTrunc) return;
    const next = stderr + chunk;
    if (Buffer.byteLength(next, "utf8") > maxErr) {
      const buf = Buffer.from(next, "utf8");
      stderr = buf.subarray(0, maxErr).toString("utf8");
      errTrunc = true;
    } else {
      stderr = next;
    }
  });

  let timedOut = false;
  let aborted = false;

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, timeoutMs);

  const onAbort = () => {
    aborted = true;
    killTree(child);
  };

  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  const exit = await new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    child.once("error", (e) => done({ exitCode: null, sig: null, spawnError: e }));
    child.once("close", (exitCode, sig) => done({ exitCode, sig, spawnError: null }));
  });

  clearTimeout(timer);
  if (signal) signal.removeEventListener("abort", onAbort);

  const durationMs = nowMs() - t0;
  const exitCode = typeof exit.exitCode === "number" ? exit.exitCode : null;
  const sig = exit.sig || undefined;

  let error = undefined;
  if (exit.spawnError) {
    error = {
      code: String(exit.spawnError?.code ?? "spawn_error"),
      message: String(exit.spawnError?.message ?? exit.spawnError)
    };
  } else if (aborted) {
    error = { code: "aborted", message: "Execution aborted" };
  } else if (timedOut) {
    error = { code: "timeout", message: `Execution timed out after ${timeoutMs}ms` };
  } else if (exitCode !== 0) {
    error = { code: "nonzero_exit", message: `Process exited with code ${exitCode}` };
  }

  const ok = !error;

  return {
    type: "exec_result",
    ok,
    cwd,
    exitCode,
    signal: sig,
    stdout,
    stderr,
    truncated: { stdout: outTrunc, stderr: errTrunc },
    durationMs,
    timedOut,
    aborted,
    shell: usedShell,
    requested,
    executed: { cmd: effectiveFile, args: effectiveArgs, command: commandStr || undefined },
    error
  };
}

// --- MCP tool defs ----------------------------------------------------------

const EXEC_TOOL_DEF = {
  name: "exec",
  title: "Execute Command",
  description: "Execute a command on the local machine. Prefer cmd+args. Returns stdout/stderr/exitCode.",
  inputSchema: {
    type: "object",
    properties: {
      cmd: {
        type: "string",
        description: "Executable to run (preferred over 'command'). Example: 'git'"
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments array. Example: ['status', '-sb']"
      },
      command: {
        type: "string",
        description: "Shell command string. Example: 'ls -la | sed -n 1,50p'"
      },
      cwd: {
        type: "string",
        description: "Working directory, relative to the project root. Default: '.'"
      },
      timeoutMs: {
        type: "number",
        description: "Execution timeout in milliseconds. Default: 60000"
      },
      maxStdoutBytes: {
        type: "number",
        description: "Max stdout bytes to capture before truncating. Default: 200000"
      },
      maxStderrBytes: {
        type: "number",
        description: "Max stderr bytes to capture before truncating. Default: 200000"
      },
      env: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Extra environment variables to set for the command."
      }
    },
    additionalProperties: false
  }
};

// --- MCP server loop --------------------------------------------------------

let initialized = false;
let shuttingDown = false;

function log(...args) {
  process.stderr.write(`[toolhost-exec] ${args.join(" ")}\n`);
}

async function handleRequest(msg) {
  const id = msg.id;
  const method = msg.method;
  const params = isRecord(msg.params) ? msg.params : {};

  if (method === "initialize") {
    const clientPV = String(params.protocolVersion ?? "").trim() || PROTOCOL_VERSION;
    // We currently support a single protocol revision.
    // If the client requests a different version, respond with the server-supported version.
    const pv = clientPV === PROTOCOL_VERSION ? clientPV : PROTOCOL_VERSION;

    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: pv,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "eclia-toolhost-exec", title: "ECLIA Exec Toolhost", version: "0.1.0" }
      }
    };
  }

  if (!initialized) {
    // Server should not accept tool requests before initialized.
    return jsonRpcError(id, -32002, "Server not initialized");
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: [EXEC_TOOL_DEF] } };
  }

  if (method === "tools/call") {
    const toolName = String(params.name ?? "").trim();
    const toolArgs = isRecord(params.arguments) ? params.arguments : {};

    if (toolName !== "exec") {
      return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
    }

    const r = await runExecTool(toolArgs, undefined);

    // Result content is a single JSON object encoded as text.
    // This keeps the gateway's tool_result handling stable, while remaining MCP compliant.
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(r) }],
        isError: !r.ok
      }
    };
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

function handleNotification(msg) {
  const method = msg.method;
  if (method === "notifications/initialized") {
    initialized = true;
    return;
  }
  if (method === "notifications/cancelled") {
    // Minimal server: we don't implement per-request cancellation yet.
    return;
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    process.stdin.destroy();
  } catch {
    // ignore
  }
  try {
    process.stdout.end();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Line-buffered stdin.
process.stdin.setEncoding("utf8");
let buf = "";

process.stdin.on("data", async (chunk) => {
  buf += chunk;

  // MCP stdio requires newline-delimited JSON-RPC.
  while (true) {
    const idx = buf.indexOf("\n");
    if (idx < 0) break;

    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);

    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (e) {
      // Can't respond reliably without an id; log and continue.
      log("bad json:", String(e?.message ?? e));
      continue;
    }

    if (!isRecord(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      // Unknown/invalid message.
      continue;
    }

    // Notifications have no id.
    if (msg.id === undefined || msg.id === null) {
      handleNotification(msg);
      continue;
    }

    // Requests
    try {
      const resp = await handleRequest(msg);
      if (resp) await writeMessageSerial(resp);
    } catch (e) {
      const id = msg.id;
      const err = jsonRpcError(id, -32603, "Internal error", { message: String(e?.message ?? e) });
      await writeMessageSerial(err);
    }
  }
});

process.stdin.on("end", () => shutdown());

// Emit a single line on stderr so developers can see it started.
log(`started (pid=${process.pid})`);
