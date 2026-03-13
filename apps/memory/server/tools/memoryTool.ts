import { isRecord } from "@eclia/utils";

export const MEMORY_TOOL_NAME = "memory";

export type MemoryMemorizeArgs = {
  action: "memorize";
  text: string;
};

export type MemoryDeleteArgs = {
  action: "delete";
  id: number;
};

export type MemoryToolArgs = MemoryMemorizeArgs | MemoryDeleteArgs;

export type MemoryToolValidationError = {
  ok: false;
  error: string;
  issues: string[];
};

export type MemoryToolValidationOk = {
  ok: true;
  value: MemoryToolArgs;
};

function asText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().replace(/\s+/g, " ");
}

function asPositiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (!Number.isSafeInteger(i) || i <= 0) return null;
  return i;
}

// ---------------------------------------------------------------------------

function validateMemorizeArgs(raw: unknown): MemoryToolValidationOk | MemoryToolValidationError {
  const obj = raw as any;
  const MAX_TEXT_CHARS = 2000;

  const text = asText(obj?.text);
  if (!text) return { ok: false, error: "invalid_args", issues: ["text is required"] };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, error: "invalid_args", issues: [`text exceeds ${MAX_TEXT_CHARS} characters`] };

  return { ok: true, value: { action: "memorize", text } };
}

function validateDeleteArgs(raw: unknown): MemoryToolValidationOk | MemoryToolValidationError {
  const obj = raw as any;

  const id = asPositiveInt(obj?.id);
  if (!id) return { ok: false, error: "invalid_args", issues: ["id must be a positive integer"] };

  return { ok: true, value: { action: "delete", id } };
}

// ---------------------------------------------------------------------------

/**
 * Strict validation + normalization for the memory tool.
 */
export function validateMemoryToolArgs(raw: unknown): MemoryToolValidationOk | MemoryToolValidationError {
  if (!isRecord(raw)) {
    return { ok: false, error: "invalid_args", issues: ["body must be a JSON object"] };
  }

  const actionRaw = (raw as any).action;
  const action = typeof actionRaw === "string" ? actionRaw.trim().toLowerCase() : "";

  if (action === "delete") return validateDeleteArgs(raw);
  if (action === "memorize" || action === "") return validateMemorizeArgs(raw);

  return { ok: false, error: "invalid_args", issues: [`unknown action: '${action}'`] };
}
