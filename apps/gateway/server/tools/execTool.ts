import { spawn } from "node:child_process";
import path from "node:path";
import { parseExecArgs, type NormalizedExecToolArgs } from "@eclia/tool-protocol";
export { parseExecArgs } from "@eclia/tool-protocol";

export type ExecToolArgs = NormalizedExecToolArgs;


export type ExecToolResult = {
  ok: boolean;
  cmd?: string;
  args?: string[];
  command?: string;
  cwd: string;
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  truncated: { stdout: boolean; stderr: boolean };
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  error?: { code: string; message: string };
};

function resolveCwd(projectRoot: string, cwdArg?: string): { ok: true; cwd: string } | { ok: false; error: string } {
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

function withHomebrewPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Apple Silicon default Homebrew prefix.
  const brewBins = ["/opt/homebrew/bin", "/opt/homebrew/sbin"];

  const key = Object.prototype.hasOwnProperty.call(env, "PATH")
    ? "PATH"
    : Object.prototype.hasOwnProperty.call(env, "Path")
      ? "Path"
      : "PATH";

  const current = String((env as any)[key] ?? "");
  const delim = path.delimiter;
  const parts = current.split(delim).filter(Boolean);

  const nextParts = [...brewBins.filter((p) => !parts.includes(p)), ...parts];
  return { ...env, [key]: nextParts.join(delim) };
}

function defaultShell(): { file: string; argsPrefix: string[] } {
  if (process.platform === "win32") {
    const file = process.env.ComSpec || "cmd.exe";
    return { file, argsPrefix: ["/d", "/s", "/c"] };
  }

  if (process.platform === "darwin") {
    return { file: "/bin/zsh", argsPrefix: ["-lc"] };
  }

  // Best-effort for other POSIX.
  const file = process.env.SHELL && process.env.SHELL.trim() ? process.env.SHELL : "/bin/bash";
  return { file, argsPrefix: ["-lc"] };
}

function killTree(child: ReturnType<typeof spawn>): void {
  try {
    if (process.platform !== "win32" && child.pid) {
      // If detached, negative PID targets the process group.
      process.kill(-child.pid, "SIGKILL");
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    // ignore
  }
}

export async function runExecTool(
  rawArgs: unknown,
  ctx: { projectRoot: string; signal?: AbortSignal }
): Promise<ExecToolResult> {
  const startedAt = Date.now();
  const args = parseExecArgs(rawArgs);

  const resolved = resolveCwd(ctx.projectRoot, args.cwd);
  if (!resolved.ok) {
    return {
      ok: false,
      cmd: args.cmd,
      args: args.args,
      command: args.command,
      cwd: path.resolve(ctx.projectRoot),
      exitCode: null,
      stdout: "",
      stderr: "",
      truncated: { stdout: false, stderr: false },
      durationMs: Date.now() - startedAt,
      timedOut: false,
      aborted: false,
      error: { code: "bad_cwd", message: resolved.error }
    };
  }

  const cwd = resolved.cwd;

  // Build environment
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...args.env };
  const env = withHomebrewPath(baseEnv);

  const timeoutMs = args.timeoutMs ?? 60_000;
  const maxStdout = args.maxStdoutBytes ?? 200_000;
  const maxStderr = args.maxStderrBytes ?? 200_000;

  let file: string;
  let spawnArgs: string[];

  if (args.cmd) {
    file = args.cmd;
    spawnArgs = Array.isArray(args.args) ? args.args : [];
  } else if (args.command) {
    const sh = defaultShell();
    file = sh.file;
    spawnArgs = [...sh.argsPrefix, args.command];
  } else {
    return {
      ok: false,
      cmd: args.cmd,
      args: args.args,
      command: args.command,
      cwd,
      exitCode: null,
      stdout: "",
      stderr: "",
      truncated: { stdout: false, stderr: false },
      durationMs: Date.now() - startedAt,
      timedOut: false,
      aborted: false,
      error: { code: "missing_command", message: "Provide either 'cmd' or 'command'." }
    };
  }

  let aborted = false;
  let timedOut = false;

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(file, spawnArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
  } catch (e: any) {
    return {
      ok: false,
      cmd: args.cmd,
      args: args.args,
      command: args.command,
      cwd,
      exitCode: null,
      stdout: "",
      stderr: "",
      truncated: { stdout: false, stderr: false },
      durationMs: Date.now() - startedAt,
      timedOut: false,
      aborted: false,
      error: { code: "spawn_failed", message: String(e?.message ?? e) }
    };
  }

  const onAbort = () => {
    aborted = true;
    killTree(child);
  };
  if (ctx.signal) {
    if (ctx.signal.aborted) onAbort();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, timeoutMs);

  const capture = (chunk: any, which: "stdout" | "stderr") => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ""));
    if (which === "stdout") {
      if (stdoutTruncated) return;
      const remaining = maxStdout - stdoutBytes;
      if (remaining <= 0) {
        stdoutTruncated = true;
        return;
      }
      if (buf.length <= remaining) {
        stdoutChunks.push(buf);
        stdoutBytes += buf.length;
      } else {
        stdoutChunks.push(buf.subarray(0, remaining));
        stdoutBytes += remaining;
        stdoutTruncated = true;
      }
      return;
    }

    if (stderrTruncated) return;
    const remaining = maxStderr - stderrBytes;
    if (remaining <= 0) {
      stderrTruncated = true;
      return;
    }
    if (buf.length <= remaining) {
      stderrChunks.push(buf);
      stderrBytes += buf.length;
    } else {
      stderrChunks.push(buf.subarray(0, remaining));
      stderrBytes += remaining;
      stderrTruncated = true;
    }
  };

  if (child.stdout) child.stdout.on("data", (c) => capture(c, "stdout"));
  if (child.stderr) child.stderr.on("data", (c) => capture(c, "stderr"));

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnErr?: any }>((resolve) => {
    let spawnErr: any = null;
    child.once("error", (e) => {
      spawnErr = e;
    });
    child.once("close", (code, sig) => {
      resolve({ code: typeof code === "number" ? code : null, signal: sig, spawnErr });
    });
  });

  clearTimeout(timer);
  if (ctx.signal) ctx.signal.removeEventListener("abort", onAbort);

  const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
  const stderr = Buffer.concat(stderrChunks).toString("utf-8");
  const durationMs = Date.now() - startedAt;

  const exitCode = exit.code;
  const signal = exit.signal ? String(exit.signal) : undefined;

  let error: ExecToolResult["error"] = undefined;
  if (exit.spawnErr) {
    error = { code: String(exit.spawnErr?.code ?? "spawn_error"), message: String(exit.spawnErr?.message ?? exit.spawnErr) };
  } else if (aborted) {
    error = { code: "aborted", message: "Execution aborted" };
  } else if (timedOut) {
    error = { code: "timeout", message: `Execution timed out after ${timeoutMs}ms` };
  } else if (exitCode !== 0) {
    error = { code: "nonzero_exit", message: `Process exited with code ${exitCode}` };
  }

  return {
    ok: !error,
    cmd: args.cmd,
    args: args.args,
    command: args.command,
    cwd,
    exitCode,
    signal,
    stdout,
    stderr,
    truncated: { stdout: stdoutTruncated, stderr: stderrTruncated },
    durationMs,
    timedOut,
    aborted,
    error
  };
}
