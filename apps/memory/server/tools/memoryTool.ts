export const MEMORY_TOOL_NAME = "memory";

export type MemoryEmitItem = {
  text: string;
  timestamps: number[];
};

export type MemoryEmitArgs = {
  memories: MemoryEmitItem[];
};

export type MemoryEmitValidationError = {
  ok: false;
  error: string;
  issues: string[];
};

export type MemoryEmitValidationOk = {
  ok: true;
  value: MemoryEmitArgs;
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

function uniqSortedInts(xs: number[]): number[] {
  const out = Array.from(new Set(xs)).sort((a, b) => a - b);
  return out;
}

/**
 * Strict validation + normalization for the memory tool.
 *
 * This is intentionally conservative: if the model produces malformed output,
 * reject the whole call so the caller can request a retry.
 */
export function validateMemoryEmitArgs(raw: unknown): MemoryEmitValidationOk | MemoryEmitValidationError {
  const issues: string[] = [];

  if (!isRecord(raw)) {
    return { ok: false, error: "invalid_args", issues: ["body must be a JSON object"] };
  }

  const memoriesRaw = (raw as any).memories;
  if (!Array.isArray(memoriesRaw)) {
    return { ok: false, error: "invalid_args", issues: ["memories must be an array"] };
  }

  if (memoriesRaw.length === 0) {
    return { ok: false, error: "invalid_args", issues: ["memories must not be empty"] };
  }

  const MAX_ITEMS = 50;
  const MAX_TEXT_CHARS = 2000;
  const MAX_TS_PER_ITEM = 64;

  if (memoriesRaw.length > MAX_ITEMS) {
    return { ok: false, error: "invalid_args", issues: [`memories must have at most ${MAX_ITEMS} items`] };
  }

  const memories: MemoryEmitItem[] = [];

  for (let i = 0; i < memoriesRaw.length; i++) {
    const itemIssues: string[] = [];
    const m = memoriesRaw[i];
    if (!isRecord(m)) {
      itemIssues.push(`memories[${i}] must be an object`);
      issues.push(...itemIssues);
      continue;
    }

    const text = asText((m as any).text);
    if (!text) {
      itemIssues.push(`memories[${i}].text is required`);
    } else if (text.length > MAX_TEXT_CHARS) {
      itemIssues.push(`memories[${i}].text exceeds ${MAX_TEXT_CHARS} characters`);
    }

    const tsRaw = (m as any).timestamps;
    if (!Array.isArray(tsRaw)) {
      itemIssues.push(`memories[${i}].timestamps must be an array`);
      issues.push(...itemIssues);
      continue;
    }

    if (tsRaw.length === 0) {
      itemIssues.push(`memories[${i}].timestamps must not be empty`);
      issues.push(...itemIssues);
      continue;
    }

    if (tsRaw.length > MAX_TS_PER_ITEM) {
      itemIssues.push(`memories[${i}].timestamps must have at most ${MAX_TS_PER_ITEM} entries`);
      issues.push(...itemIssues);
      continue;
    }

    const ts: number[] = [];
    for (let j = 0; j < tsRaw.length; j++) {
      const v = asInt(tsRaw[j]);
      if (v === null || v < 0) {
        itemIssues.push(`memories[${i}].timestamps[${j}] must be an integer >= 0`);
        continue;
      }
      ts.push(v);
    }

    if (itemIssues.length) {
      issues.push(...itemIssues);
      continue;
    }

    memories.push({ text, timestamps: uniqSortedInts(ts) });
  }

  if (issues.length) return { ok: false, error: "invalid_args", issues };
  return { ok: true, value: { memories } };
}

/**
 * OpenAI-compatible tool schema (for future genesis stages).
 *
 * NOTE: kept here so the caller doesn't need to duplicate the JSON schema.
 */
export function memoryToolSchema() {
  return {
    type: "function",
    function: {
      name: MEMORY_TOOL_NAME,
      description:
        "Emit extracted long-term memory candidates as structured items. Use this ONLY for facts worth remembering.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          memories: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string", minLength: 1, maxLength: 2000 },
                timestamps: {
                  type: "array",
                  minItems: 1,
                  maxItems: 64,
                  items: { type: "integer", minimum: 0 }
                }
              },
              required: ["text", "timestamps"]
            }
          }
        },
        required: ["memories"]
      }
    }
  } as const;
}
