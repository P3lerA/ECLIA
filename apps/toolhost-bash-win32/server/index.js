import path from "node:path";
import { execFileSync } from "node:child_process";
import { startToolhostServer } from "@eclia/tool-protocol/toolhost-core";

// --- Win32 platform config ---------------------------------------------------

function defaultShell() {
  // Windows command shell.
  const file = process.env.ComSpec || "cmd.exe";
  return { file, argsPrefix: ["/d", "/s", "/c"] };
}

function killTree(child) {
  if (!child.pid) {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    return;
  }
  // taskkill /T kills the entire process tree; /F forces termination.
  try {
    execFileSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", timeout: 5000 });
  } catch {
    // Fallback: process may have already exited.
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
  }
}

function applyPlatformPathFixes(env) {
  // Windows: no special PATH munging by default.
  return env;
}

function getSpawnOptions(effectiveFile, _effectiveArgs, baseOpts) {
  // IMPORTANT:
  // When spawning cmd.exe, Node's default Windows argument quoting can break
  // complex strings (especially nested quotes), which in turn breaks PowerShell
  // "-Command" payloads. Using verbatim args makes cmd.exe parsing much more
  // predictable.
  const isCmdExe =
    typeof effectiveFile === "string" && path.basename(effectiveFile).toLowerCase() === "cmd.exe";

  return {
    ...baseOpts,
    detached: false,
    windowsVerbatimArguments: isCmdExe,
    windowsHide: true
  };
}

// --- Start -------------------------------------------------------------------

startToolhostServer({
  platformName: "win32",
  defaultShell,
  killTree,
  applyPlatformPathFixes,
  getSpawnOptions,
  toolDef: {
    name: "bash",
    title: "Execute Command",
    description: "Execute a command on this machine (Windows). Provide a shell command string in 'command'. Commands that do not exit within the timeout (default 60s) are killed. To start long-running services (servers, etc.), background them: 'start /B cmd /c myserver.bat > NUL 2>&1'. Skills live under %ECLIA_SKILLS_DIR%/<name> (or $env:ECLIA_SKILLS_DIR in PowerShell). For large/binary outputs, write files to %ECLIA_ARTIFACT_DIR% (or $env:ECLIA_ARTIFACT_DIR in PowerShell). Avoid printing huge base64 blobs; decode to a file instead. Files created there will be returned as artifacts. Each artifact includes: path (repo-relative), uri (eclia://artifact/...), and ref (<eclia://artifact/...>) for copy/paste referencing. Returns stdout/stderr/exitCode.",
    commandDescription: "Shell command string (pipes/redirection). Example: 'dir | findstr \".js\"'."
  },
  serverInfo: {
    name: "eclia-toolhost-bash-win32",
    title: "ECLIA Bash Toolhost (Windows)",
    version: "0.1.0"
  }
});
