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
    };

function isRecord(v: unknown): v is Record<string, any> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
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

    // 2) Exec results: for ok runs, show only stdout/stderr.
    // The payload shape differs between:
    // - live SSE blocks: payload === output
    // - persisted blocks: payload === { callId, ok, output }
    const isExecTool = block.name === "exec" || block.name === "execution";
    if (isExecTool && (block.status === "ok" || block.status === "error")) {
      const out = isRecord(payload) && isRecord(payload.output) ? payload.output : payload;

      if (!isRecord(out)) return null;

      // Only do the concise view for successful execs; errors keep JSON by default.
      const ok =
        typeof (out as any).ok === "boolean"
          ? Boolean((out as any).ok)
          : isRecord(payload) && typeof (payload as any).ok === "boolean"
            ? Boolean((payload as any).ok)
            : block.status === "ok";

      if (!ok) return null;

      const stdout = typeof (out as any).stdout === "string" ? (out as any).stdout : "";
      const stderr = typeof (out as any).stderr === "string" ? (out as any).stderr : "";

      return {
        kind: "exec_stdout_stderr",
        stdout: stdout || undefined,
        stderr: stderr || undefined
      };
    }

    return null;
  } catch {
    return null;
  }
}

