import { safeJsonStringify } from "@eclia/utils";

export const MEMORY_TOOL_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["extract", "delete", "merge"],
      description: "Operation to perform. Defaults to 'extract' if omitted."
    },
    // extract
    text: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
      description: "(extract) The memory fact to store."
    },
    timestamps: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "integer", minimum: 0 },
      description: "(extract) Unix timestamps (seconds) of the messages this fact was derived from."
    },
    // delete / merge
    ids: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: { type: "integer", minimum: 1 },
      description: "(delete, merge) Fact IDs to delete or merge."
    },
    // merge
    content: {
      type: "string",
      minLength: 1,
      maxLength: 4000,
      description: "(merge) The merged fact text that replaces the source facts."
    }
  }
} as const;

export async function invokeMemoryTool(args: {
  config: any;
  sessionId: string;
  callId: string;
  parsedArgs: any;
  timeoutMs?: number;
}): Promise<{ ok: boolean; result: any }> {
  const memHost = String((args.config as any)?.memory?.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const memPortRaw = (args.config as any)?.memory?.port;
  const memPort =
    typeof memPortRaw === "number" && memPortRaw > 0
      ? memPortRaw
      : typeof memPortRaw === "string" && Number(memPortRaw) > 0
        ? Number(memPortRaw)
        : 8788;

  const url = `http://${memHost}:${memPort}/tools/memory`;

  const payload =
    args.parsedArgs && typeof args.parsedArgs === "object" && !Array.isArray(args.parsedArgs)
      ? { ...(args.parsedArgs as any), __eclia: { sessionId: args.sessionId, callId: args.callId } }
      : { value: args.parsedArgs, __eclia: { sessionId: args.sessionId, callId: args.callId } };

  const timeoutMs = typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) ? Math.trunc(args.timeoutMs) : 30_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1_000, Math.min(10 * 60_000, timeoutMs)));

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!resp.ok) {
      return {
        ok: false,
        result: {
          ok: false,
          error: { code: "memory_tool_error", message: `memory tool HTTP ${resp.status}` },
          details: json ?? text
        }
      };
    }

    return { ok: true, result: json ?? { ok: true, raw: text } };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return {
      ok: false,
      result: {
        ok: false,
        error: { code: "memory_service_unreachable", message: msg },
        url
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

export function safeMemoryToolResultForModel(v: unknown): string {
  // Keep tool results compact for the model; the full payload is persisted in transcript.
  try {
    const s = safeJsonStringify(v);
    // cap to avoid blowing up context
    const max = 20_000;
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(v);
  }
}
