import type { ToolBlock } from "../types";

export type FormattedToolPayload =
  | {
      kind: "tool_call_raw";
      raw: string;
      parseError?: string;
    }
  | {
      kind: "exec_stdout_stderr";
      stdout?: string;
      stderr?: string;
    }
  | {
      kind: "exec_error_summary";
      stdout?: string;
      stderr?: string;
      exitCode: number | null;
    }
  | {
      kind: "send_error_summary";
      stdout?: string;
      stderr?: string;
      exitCode: number | null;
    };

function isRecord(v: unknown): v is Record<string, any> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function parseExitCode(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Try to render a tool block payload in a concise, human-friendly form.
 *
 * Important: this must be best-effort and never throw.
 * - Return `null` when unsure so callers can fall back to JSON.
 * - Keep the logic compact and additive (new tools add new branches).
 */
export function tryFormatToolPayload(block: ToolBlock, payload: any): FormattedToolPayload | null {
  try {
    // 1) Tool call: show the raw arguments (verbatim string) when available.
    if (block.status === "calling") {
      const raw =
        typeof payload === "string"
          ? payload
          : isRecord(payload) && typeof payload.raw === "string"
            ? payload.raw
            : isRecord(payload) && typeof (payload as any).argsRaw === "string"
              ? String((payload as any).argsRaw)
              : "";

      const parseError = isRecord(payload) && typeof payload.parseError === "string" ? payload.parseError : undefined;

      // If we can't find a clean "raw" string, let the caller fall back to JSON.
      if (!raw) return null;
      return { kind: "tool_call_raw", raw, parseError };
    }

    // 2) Exec results: show only stdout/stderr (and exitCode on errors).
    // The payload shape differs between:
    // - live SSE blocks: payload === output
    // - persisted blocks: payload === { callId, ok, output }
    const isExecTool = block.name === "exec";
    if (isExecTool && (block.status === "ok" || block.status === "error")) {
      const out = isRecord(payload) && isRecord(payload.output) ? payload.output : payload;
      if (!isRecord(out)) return null;

      const ok =
        typeof (out as any).ok === "boolean"
          ? Boolean((out as any).ok)
          : isRecord(payload) && typeof (payload as any).ok === "boolean"
            ? Boolean((payload as any).ok)
            : block.status === "ok";

      const stdout = typeof (out as any).stdout === "string" ? (out as any).stdout : "";
      const stderr = typeof (out as any).stderr === "string" ? (out as any).stderr : "";

      if (ok) {
        return {
          kind: "exec_stdout_stderr",
          stdout: stdout || undefined,
          stderr: stderr || undefined
        };
      }

      return {
        kind: "exec_error_summary",
        stdout: stdout || undefined,
        stderr: stderr || undefined,
        exitCode: parseExitCode((out as any).exitCode)
      };
    }

    // 3) Send errors: show only stdout/stderr/exitCode (if present). In most cases,
    // send failures carry an { error: { code, message } } payload, so we surface the
    // message as stderr to keep the UI consistent with exec errors.
    const isSendTool = block.name === "send";
    if (isSendTool && block.status === "error") {
      const out = isRecord(payload) && isRecord(payload.output) ? payload.output : payload;
      if (!isRecord(out)) {
        return { kind: "send_error_summary", exitCode: null };
      }

      const stdout = typeof (out as any).stdout === "string" ? String((out as any).stdout) : "";
      let stderr = typeof (out as any).stderr === "string" ? String((out as any).stderr) : "";

      if (!stderr) {
        const errObj = isRecord((out as any).error) ? (out as any).error : null;
        const code = errObj && typeof errObj.code === "string" ? String(errObj.code) : "";
        const msg = errObj && typeof errObj.message === "string" ? String(errObj.message) : "";
        if (msg) stderr = code ? `[${code}] ${msg}` : msg;
      }

      return {
        kind: "send_error_summary",
        stdout: stdout || undefined,
        stderr: stderr || undefined,
        exitCode: parseExitCode((out as any).exitCode)
      };
    }

    return null;
  } catch {
    return null;
  }
}
