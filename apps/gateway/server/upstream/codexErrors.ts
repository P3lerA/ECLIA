type SpawnErrorLike = Error & {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
  spawnargs?: string[];
};

/**
 * Normalize Codex app-server failures into a user-facing message.
 *
 * Keep this logic centralized so callers don't all re-implement slightly
 * different heuristics.
 */
export function formatCodexError(err: unknown): string {
  const e = err instanceof Error ? (err as SpawnErrorLike) : null;
  const raw = e?.message ? String(e.message) : String(err ?? "");
  const msg = raw.trim();

  // Common case: the `codex` executable can't be found.
  const code = e?.code;
  if (code === "ENOENT" || /\bENOENT\b/i.test(msg)) {
    const exe = (process.env.ECLIA_CODEX_EXECUTABLE ?? "codex").trim() || "codex";
    return (
      `Failed to launch Codex app-server (spawn ENOENT). Executable not found: ${exe}. ` +
      `Install the Codex CLI (e.g. "npm i -g @openai/codex") or set ECLIA_CODEX_EXECUTABLE ` +
      `to the full path of the codex binary, then restart the gateway.`
    );
  }

  if (msg) return msg;

  return "Unknown Codex error";
}
