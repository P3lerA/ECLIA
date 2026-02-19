import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseExecArgs, artifactRefFromRepoRelPath } from "@eclia/tool-protocol";


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

function expandEcliaSkillsDirPlaceholders(s, skillsDirAbs) {
  if (typeof s !== "string" || !skillsDirAbs) return s;

  return s
    .replace(/\$\{ECLIA_SKILLS_DIR\}/g, skillsDirAbs)
    .replace(/\$ECLIA_SKILLS_DIR(?![A-Za-z0-9_])/g, skillsDirAbs)
    .replace(/%ECLIA_SKILLS_DIR%/g, skillsDirAbs)
    .replace(/\$env:ECLIA_SKILLS_DIR\b/g, skillsDirAbs);
}

function expandExecArgsSkillsDir(args, skillsDirAbs) {
  if (!args || typeof args !== "object" || !skillsDirAbs) return args;

  if (typeof args.cwd === "string") args.cwd = expandEcliaSkillsDirPlaceholders(args.cwd, skillsDirAbs);
  if (typeof args.cmd === "string") args.cmd = expandEcliaSkillsDirPlaceholders(args.cmd, skillsDirAbs);
  if (typeof args.command === "string") args.command = expandEcliaSkillsDirPlaceholders(args.command, skillsDirAbs);
  if (Array.isArray(args.args)) {
    args.args = args.args.map((a) => (typeof a === "string" ? expandEcliaSkillsDirPlaceholders(a, skillsDirAbs) : a));
  }

  return args;
}

// --- Exec implementation ----------------------------------------------------

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

function applyPlatformPathFixes(env) {
  // Windows: no special PATH munging by default.
  return env;
}

function sanitizeNpmEnvForNvm(inheritedEnv, userEnv) {
  // Even on Windows, callers may run Git-Bash/WSL shells or ship nvm-like tooling.
  // npm/pnpm inject npm_config_* variables when running scripts; a common one
  // (npm_config_prefix) can cause noisy warnings in nvm-based setups.
  //
  // We drop them from the inherited environment by default, but allow callers
  // to explicitly set them via args.env if they really want them.
  const cleaned = { ...inheritedEnv };
  const allow = userEnv && typeof userEnv === "object" ? userEnv : {};

  const maybeDelete = (k) => {
    if (Object.prototype.hasOwnProperty.call(allow, k)) return;
    try {
      delete cleaned[k];
    } catch {
      // ignore
    }
  };

  maybeDelete("npm_config_prefix");
  maybeDelete("NPM_CONFIG_PREFIX");
  maybeDelete("PREFIX");
  maybeDelete("prefix");

  return cleaned;
}


function defaultShell() {
  // Windows command shell.
  const file = process.env.ComSpec || "cmd.exe";
  return { file, argsPrefix: ["/d", "/s", "/c"] };
}

function killTree(child) {
  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
}




function normalizeRelPath(p) {
  return p.split(path.sep).join("/");
}

function safePathSegment(s) {
  const cleaned = String(s ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

function guessMimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".txt":
    case ".log":
    case ".md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function kindFromMime(mime, filePath) {
  if (typeof mime === "string" && mime.startsWith("image/")) return "image";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (typeof mime === "string" && mime.startsWith("text/")) return "text";
  return "file";
}

function sha256FileMaybe(absPath, maxBytes) {
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) return undefined;
    if (typeof maxBytes === "number" && st.size > maxBytes) return undefined;
    const buf = fs.readFileSync(absPath);
    const h = crypto.createHash("sha256");
    h.update(buf);
    return h.digest("hex");
  } catch {
    return undefined;
  }
}

function collectArtifacts(artifactDirAbs, projectRootAbs) {
  const artifacts = [];
  const maxFiles = 32;

  const queue = [artifactDirAbs];
  while (queue.length && artifacts.length < maxFiles) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (artifacts.length >= maxFiles) break;
      const abs = path.join(dir, ent.name);

      if (ent.isDirectory()) {
        queue.push(abs);
        continue;
      }

      if (!ent.isFile()) continue;

      try {
        const st = fs.statSync(abs);
        const mime = guessMimeFromPath(abs);
        const rel = normalizeRelPath(path.relative(projectRootAbs, abs));
        const { uri, ref } = artifactRefFromRepoRelPath(rel);
        artifacts.push({
          kind: kindFromMime(mime, abs),
          path: rel,
          uri,
          ref,
          role: "artifact",
          bytes: st.size,
          mime,
          sha256: sha256FileMaybe(abs, 5_000_000)
        });
      } catch {
        // ignore this entry
      }
    }
  }

  return artifacts;
}

function resourceLinksFromArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || !artifacts.length) return [];
  const out = [];
  for (const a of artifacts) {
    const uri = typeof a?.uri === "string" ? a.uri : "";
    if (!uri) continue;

    const p = typeof a?.path === "string" ? a.path : "";
    const name = typeof a?.name === "string" && a.name.trim() ? a.name.trim() : p ? path.basename(p) : "artifact";
    const mimeType = typeof a?.mime === "string" ? a.mime : undefined;
    const description = typeof a?.ref === "string" && a.ref ? a.ref : p ? p : undefined;

    out.push({ type: "resource_link", uri, name, mimeType, description });
  }
  return out;
}

function readEcliaMeta(rawArgs) {
  if (!rawArgs || typeof rawArgs !== "object") return { sessionId: "", callId: "" };
  const m = rawArgs.__eclia;
  if (!m || typeof m !== "object") return { sessionId: "", callId: "" };
  const sessionId = typeof m.sessionId === "string" ? m.sessionId : "";
  const callId = typeof m.callId === "string" ? m.callId : "";
  return { sessionId, callId };
}

async function runExecTool(rawArgs, signal) {
  const t0 = nowMs();
  const meta = readEcliaMeta(rawArgs);
  const args = parseExecArgs(rawArgs);
  const projectRoot = process.cwd();
  const skillsDirAbs = path.join(projectRoot, "skills");
  expandExecArgsSkillsDir(args, skillsDirAbs);

  const artifactsRoot = path.join(projectRoot, ".eclia", "artifacts");
  const artifactDirAbs =
    meta.sessionId && meta.callId
      ? path.join(artifactsRoot, safePathSegment(meta.sessionId), safePathSegment(meta.callId))
      : null;

  if (artifactDirAbs) {
    try {
      fs.mkdirSync(artifactDirAbs, { recursive: true });
    } catch {
      // ignore
    }
  }

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

  // npm/pnpm inject npm_config_* variables when running scripts. Some environments
  // (especially when using nvm in a Git-Bash-like shell) emit warnings when
  // npm_config_prefix is set. Strip it from inherited env by default.
  const inheritedEnv = sanitizeNpmEnvForNvm({ ...process.env }, args.env);
  const baseEnv0 = applyPlatformPathFixes({ ...inheritedEnv, ...args.env });
  const baseEnv = { ...baseEnv0, ECLIA_SKILLS_DIR: skillsDirAbs };
  const env =
    artifactDirAbs
      ? {
          ...baseEnv,
          ECLIA_ARTIFACT_DIR: artifactDirAbs,
          ECLIA_SESSION_ID: meta.sessionId,
          ECLIA_TOOL_CALL_ID: meta.callId
        }
      : baseEnv;

  // IMPORTANT:
  // When spawning cmd.exe, Node's default Windows argument quoting can break
  // complex strings (especially nested quotes), which in turn breaks PowerShell
  // "-Command" payloads. Using verbatim args makes cmd.exe parsing much more
  // predictable.
  const isCmdExe =
    typeof effectiveFile === "string" && path.basename(effectiveFile).toLowerCase() === "cmd.exe";

  let child;
  try {
    child = spawn(effectiveFile, effectiveArgs, {
      cwd,
      shell: false,
      env,
      windowsVerbatimArguments: isCmdExe,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false
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

  let artifacts = [];
  let artifactDir = undefined;

  if (artifactDirAbs) {
    artifacts = collectArtifacts(artifactDirAbs, projectRoot);

    if (artifacts.length) {
      artifactDir = normalizeRelPath(path.relative(projectRoot, artifactDirAbs));
    } else {
      // Avoid leaving lots of empty folders behind.
      try {
        fs.rmSync(artifactDirAbs, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

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
    artifactDir,
    artifacts: artifacts.length ? artifacts : undefined,
    error
  };
}

// --- MCP tool defs ----------------------------------------------------------

const EXEC_TOOL_DEF = {
  name: "exec",
  title: "Execute Command",
  description: "Execute a command on this machine (Windows). Prefer cmd+args. Skills live under %ECLIA_SKILLS_DIR%/<name> (or $env:ECLIA_SKILLS_DIR in PowerShell). For large/binary outputs, write files to %ECLIA_ARTIFACT_DIR% (or $env:ECLIA_ARTIFACT_DIR in PowerShell). Avoid printing huge base64 blobs; decode to a file instead. Files created there will be returned as artifacts. Each artifact includes: path (repo-relative), uri (eclia://artifact/...), and ref (<eclia://artifact/...>) for copy/paste referencing. Returns stdout/stderr/exitCode.",
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
  process.stderr.write(`[toolhost-exec-win32] ${args.join(" ")}\n`);
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
        serverInfo: { name: "eclia-toolhost-exec-win32", title: "ECLIA Exec Toolhost (Windows)", version: "0.1.0" }
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

    // MCP-native output:
    // - structuredContent is the canonical machine-readable payload
    // - content includes a JSON text fallback + resource_link blocks for artifacts
    const artifacts = Array.isArray(r?.artifacts) ? r.artifacts : [];
    const content = [{ type: "text", text: JSON.stringify(r) }, ...resourceLinksFromArtifacts(artifacts)];

    return {
      jsonrpc: "2.0",
      id,
      result: {
        structuredContent: r,
        content,
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
