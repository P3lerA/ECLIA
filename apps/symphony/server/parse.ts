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
