export type SystemInstructionPart = {
  /** Stable identifier for debugging and deterministic ordering (e.g. "toml", "skill:pdfs"). */
  id: string;

  /** Where this part comes from (for diagnostics/telemetry). */
  source: "toml" | "skills" | "provider" | "adapter" | "runtime" | string;

  /** Lower runs earlier; higher runs later. */
  priority: number;

  /** Raw instruction content. */
  content: string;

  /** Optional: disable without deleting. */
  enabled?: boolean;
};

export type ComposedSystemInstruction = {
  /** The final instruction text intended to be injected as a *single* system message (or equivalent). */
  text: string;

  /** Filtered, ordered parts used to build `text`. */
  parts: SystemInstructionPart[];
};

/**
 * Compose a single system instruction from multiple sources.
 *
 * Design goals:
 * - Deterministic ordering.
 * - Easy to extend with new sources (skills, provider defaults, adapter-specific, etc.).
 * - Keep the gateway's "one system message" invariant for OpenAI-compatible providers.
 */
export function composeSystemInstruction(parts: SystemInstructionPart[]): ComposedSystemInstruction {
  const filtered = parts
    .filter((p) => p && p.enabled !== false)
    .map((p) => ({ ...p, content: String(p.content ?? "") }))
    .filter((p) => p.content.trim().length > 0);

  filtered.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Stable tie-breaker for deterministic results.
    return a.id.localeCompare(b.id);
  });

  // Preserve the original text of each part (except trimming boundaries), and
  // join with a blank line to keep human-readable separation.
  const text = filtered.map((p) => p.content.trim()).join("\n\n");

  return { text, parts: filtered };
}
