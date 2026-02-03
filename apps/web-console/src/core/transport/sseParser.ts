/**
 * Minimal SSE parser:
 * - Split event blocks by \n\n
 * - Recognize event: / data:
 * - Support multi-line data (joined by \n)
 *
 * Note: this is a "good-enough" parser. In production you may want to handle:
 * - retry/id/comment lines
 * - CRLF (\r\n) compatibility
 */
export function parseSSE(input: string): {
  events: Array<{ event: string | null; data: string }>;
  rest: string;
} {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");

  // The last chunk may be an incomplete block; keep it for the next read.
  const rest = parts.pop() ?? "";

  const events: Array<{ event: string | null; data: string }> = [];

  for (const part of parts) {
    const lines = part.split("\n").filter(Boolean);
    let eventName: string | null = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    events.push({ event: eventName, data: dataLines.join("\n") });
  }

  return { events, rest };
}
