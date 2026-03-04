export const MEMORY_TOOL_NAME = "memory";

export type MemoryExtractCandidate = {
  text: string;
  timestamps: number[];
};

export type MemoryDeleteArgs = {
  action: "delete";
  ids: number[];
};

export type MemoryMergeArgs = {
  action: "merge";
  ids: number[];
  content: string;
};

export type MemoryToolArgs =
  | ({ action: "extract" } & MemoryExtractCandidate)
  | MemoryDeleteArgs
  | MemoryMergeArgs;

export type MemoryToolValidationError = {
  ok: false;
  error: string;
  issues: string[];
};

export type MemoryToolValidationOk = {
  ok: true;
  value: MemoryToolArgs;
};

function isRecord(v: unknown): v is Record<string, any> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().replace(/\s+/g, " ");
}

function asInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (!Number.isSafeInteger(i)) return null;
  return i;
}

function parseTimestampsFromString(s: string): number[] | null {
  const t = String(s ?? "").trim();
  if (!t) return null;

  const parseCsv = (csv: string): number[] | null => {
    const parts = csv
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return [];
    const out: number[] = [];
    for (const p of parts) {
      if (!/^\d+$/.test(p)) return null;
      const n = Number(p);
      if (!Number.isSafeInteger(n) || n < 0) return null;
      out.push(n);
    }
    return out;
  };

  // Single integer as string.
  if (/^\d+$/.test(t)) return [Number(t)];

  // Comma-separated integers.
  if (/^\d+(\s*,\s*\d+)*$/.test(t)) return parseCsv(t);

  // JSON-ish bracket list: [1, 2, 3]
  if (/^\[\s*\d+(\s*,\s*\d+)*\s*\]$/.test(t)) {
    const inner = t.replace(/^\[\s*/, "").replace(/\s*\]$/, "");
    return parseCsv(inner);
  }

  // Some models double-quote the list string: "[1,2]".
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    const unq = t.slice(1, -1);
    return parseTimestampsFromString(unq);
  }

  return null;
}

function uniqSortedInts(xs: number[]): number[] {
  return Array.from(new Set(xs)).sort((a, b) => a - b);
}

function parseIds(raw: unknown): number[] | null {
  let list: unknown[] | null = null;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === "number") {
    list = [raw];
  } else if (typeof raw === "string") {
    const parsed = parseTimestampsFromString(raw);
    if (parsed !== null) list = parsed;
  }
  if (!list) return null;
  const out: number[] = [];
  for (const v of list) {
    const n = asInt(v);
    if (n === null || n <= 0) return null;
    out.push(n);
  }
  return out.length ? uniqSortedInts(out) : null;
}

// ---------------------------------------------------------------------------

function validateExtractArgs(raw: unknown): MemoryToolValidationOk | MemoryToolValidationError {
  const issues: string[] = [];

  const obj = raw as any;

  const MAX_TEXT_CHARS = 2000;
  const MAX_TS_PER_ITEM = 64;

  const text = asText(obj?.text);
  if (!text) {
    issues.push("text is required");
  } else if (text.length > MAX_TEXT_CHARS) {
    issues.push(`text exceeds ${MAX_TEXT_CHARS} characters`);
  }

  // NOTE: Some upstream models frequently serialize numeric arrays as strings
  // (e.g. "[1772235673, 1772239924]"). Coerce those forms into a real number[]
  // so the model doesn't get stuck retrying on a superficial type mismatch.
  const tsRaw = obj?.timestamps;
  let tsList: unknown[] | null = null;
  if (Array.isArray(tsRaw)) {
    tsList = tsRaw;
  } else if (typeof tsRaw === "number") {
    tsList = [tsRaw];
  } else if (typeof tsRaw === "string") {
    const parsed = parseTimestampsFromString(tsRaw);
    if (parsed !== null) tsList = parsed;
  }

  if (!tsList) {
    issues.push("timestamps must be an array");
  } else if (tsList.length === 0) {
    issues.push("timestamps must not be empty");
  } else if (tsList.length > MAX_TS_PER_ITEM) {
    issues.push(`timestamps must have at most ${MAX_TS_PER_ITEM} entries`);
  }

  const ts: number[] = [];
  if (tsList) {
    for (let j = 0; j < tsList.length; j++) {
      const v = asInt(tsList[j]);
      if (v === null || v < 0) {
        issues.push(`timestamps[${j}] must be an integer >= 0`);
        continue;
      }
      ts.push(v);
    }
  }

  if (issues.length) return { ok: false, error: "invalid_args", issues };
  return { ok: true, value: { action: "extract", text, timestamps: uniqSortedInts(ts) } };
}

function validateDeleteArgs(raw: unknown): MemoryToolValidationOk | MemoryToolValidationError {
  const obj = raw as any;
  const MAX_IDS = 200;

  const ids = parseIds(obj?.ids);
  if (!ids) {
    return { ok: false, error: "invalid_args", issues: ["ids must be a non-empty array of positive integers"] };
  }
  if (ids.length > MAX_IDS) {
    return { ok: false, error: "invalid_args", issues: [`ids must have at most ${MAX_IDS} entries`] };
  }

  return { ok: true, value: { action: "delete", ids } };
}

function validateMergeArgs(raw: unknown): MemoryToolValidationOk | MemoryToolValidationError {
  const issues: string[] = [];
  const obj = raw as any;
  const MAX_IDS = 200;
  const MAX_CONTENT_CHARS = 4000;

  const ids = parseIds(obj?.ids);
  if (!ids) {
    issues.push("ids must be a non-empty array of positive integers");
  } else if (ids.length < 2) {
    issues.push("ids must contain at least 2 entries to merge");
  } else if (ids.length > MAX_IDS) {
    issues.push(`ids must have at most ${MAX_IDS} entries`);
  }

  const content = asText(obj?.content);
  if (!content) {
    issues.push("content is required");
  } else if (content.length > MAX_CONTENT_CHARS) {
    issues.push(`content exceeds ${MAX_CONTENT_CHARS} characters`);
  }

  if (issues.length) return { ok: false, error: "invalid_args", issues };
  return { ok: true, value: { action: "merge", ids: ids!, content } };
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
  if (action === "merge") return validateMergeArgs(raw);

  // Default: extract (backward-compatible — stage 1 callers omit action).
  return validateExtractArgs(raw);
}
