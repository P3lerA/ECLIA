import type { InstrumentDef } from "./types.js";

/**
 * Parse an array of raw {kind, config} entries from untrusted input.
 * Used by the API handlers and startup loader.
 */
export function parseEntries(arr: unknown[]): Array<{ kind: string; config: Record<string, unknown> }> {
  return (arr as any[])
    .filter((e: any) => typeof e?.kind === "string" && e.kind.trim())
    .map((e: any) => ({
      kind: e.kind.trim(),
      config: e.config && typeof e.config === "object" && !Array.isArray(e.config) ? e.config : {}
    }));
}

/**
 * Build a validated InstrumentDef from raw/untrusted input.
 * Shared by startup loader and API create/update.
 */
export function buildInstrumentDef(raw: {
  id: string;
  name?: string;
  enabled?: boolean;
  triggers: unknown[];
  actions: unknown[];
}): InstrumentDef {
  const triggers = parseEntries(raw.triggers);
  const actions = parseEntries(raw.actions);
  if (!triggers.length) throw new Error("missing triggers");
  if (!actions.length) throw new Error("missing actions");
  return {
    id: raw.id,
    name: raw.name?.trim() || raw.id,
    enabled: raw.enabled !== false,
    trigger: { mode: "any", sources: triggers },
    actions
  };
}
