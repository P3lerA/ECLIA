import path from "node:path";
import { startToolhostServer } from "@eclia/tool-protocol/toolhost-core";

// --- POSIX platform config ---------------------------------------------------

function defaultShell() {
  if (process.platform === "darwin") {
    return { file: "/bin/zsh", argsPrefix: ["-lc"] };
  }

  const file = process.env.SHELL && process.env.SHELL.trim() ? process.env.SHELL : "/bin/bash";
  return { file, argsPrefix: ["-lc"] };
}

function killTree(child) {
  try {
    if (child.pid) {
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

function withHomebrewPathDarwin(env) {
  // Apple Silicon default Homebrew prefix.
  // NOTE: Only applies on macOS (darwin).
  const brewBins = ["/opt/homebrew/bin", "/opt/homebrew/sbin"];

  const key = "PATH";
  const current = String(env[key] ?? "");
  const delim = path.delimiter;
  const parts = current.split(delim).filter(Boolean);

  const nextParts = [...brewBins.filter((p) => !parts.includes(p)), ...parts];
  return { ...env, [key]: nextParts.join(delim) };
}

function applyPlatformPathFixes(env) {
  if (process.platform === "darwin") return withHomebrewPathDarwin(env);
  return env;
}

function getSpawnOptions(_effectiveFile, _effectiveArgs, baseOpts) {
  return { ...baseOpts, detached: true };
}

// --- Start -------------------------------------------------------------------

startToolhostServer({
  platformName: "posix",
  defaultShell,
  killTree,
  applyPlatformPathFixes,
  getSpawnOptions,
  toolDef: {
    name: "bash",
    title: "Execute Command",
    description: "Execute a command on this machine (POSIX shell: macOS/Linux). Commands that do not exit within the timeout (default 60s) are killed. To start long-running services (servers, webui.sh, etc.), background them: 'nohup ./start.sh > /dev/null 2>&1 & echo $!' — this returns the PID immediately. For large/binary outputs, write files to $ECLIA_ARTIFACT_DIR (provided automatically). Files created there will be returned as artifacts. Each artifact includes: path (repo-relative), uri (eclia://artifact/...), and ref (<eclia://artifact/...>) for copy/paste referencing. Returns stdout/stderr/exitCode.",
    commandDescription: "Shell command string (pipes/redirection). Example: 'ls -la | sed -n 1,50p'."
  },
  serverInfo: {
    name: "eclia-toolhost-bash-posix",
    title: "ECLIA Bash Toolhost (POSIX)",
    version: "0.1.0"
  }
});
