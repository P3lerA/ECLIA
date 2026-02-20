import crypto from "node:crypto";

import type { ToolCall } from "../upstream/provider.js";

export type ParsedAssistantToolCall = {
  call: ToolCall;
  warning: string;
  line: string;
};

function coerceNonEmptyString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function safeCallId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

function makeCallId(prefix: string, idx: number): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${rand}_${idx}`;
}

function inferArgsRaw(obj: any): string {
  const raw = coerceNonEmptyString(obj?.raw);
  if (raw) return raw;

  const argsRaw = coerceNonEmptyString(obj?.argsRaw);
  if (argsRaw) return argsRaw;

  const argsStr = coerceNonEmptyString(obj?.args);
  if (argsStr) return argsStr;

  const argsObj = obj?.args;
  if (argsObj && typeof argsObj === "object") {
    try {
      return JSON.stringify(argsObj);
    } catch {
      // fall through
    }
  }

  const argumentsObj = obj?.arguments;
  if (argumentsObj && typeof argumentsObj === "object") {
    try {
      return JSON.stringify(argumentsObj);
    } catch {
      // fall through
    }
  }

  return "{}";
}

function tryParseJsonObject(s: string): any | null {
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object") return v;
    return null;
  } catch {
    return null;
  }
}

export function parseAssistantToolCallsFromText(text: string, allowedToolNames: Set<string>): ParsedAssistantToolCall[] {
  const out: ParsedAssistantToolCall[] = [];
  const src = typeof text === "string" ? text : "";
  if (!src.trim()) return out;

  const lines = src.split(/\r?\n/g);

  const patterns: Array<{ kind: string; re: RegExp }> = [
    {
      kind: "tool_transcript",
      re: /^Tool\s+([a-zA-Z0-9._-]+)\s*\(\s*(?:calling|call)\s*\)\s*:\s*(\{.*\})\s*$/
    },
    {
      kind: "tagged_tool",
      // Example: [tool:exec] {"command":"..."}
      re: /^\[tool:([a-zA-Z0-9._-]+)\]\s*(\{.*\})\s*(?:<\/tool:\1>)?\s*$/
    }
  ];

  for (let i = 0; i < lines.length; i++) {
    const lineRaw = lines[i];
    const line = String(lineRaw ?? "").trim();
    if (!line) continue;

    for (const pat of patterns) {
      const m = line.match(pat.re);
      if (!m) continue;

      const name = coerceNonEmptyString(m[1]);
      if (!name) continue;
      if (allowedToolNames.size && !allowedToolNames.has(name)) continue;

      const jsonPart = coerceNonEmptyString(m[2]);
      const obj = tryParseJsonObject(jsonPart);
      if (!obj) continue;

      const callIdCandidate = coerceNonEmptyString(obj?.callId) || coerceNonEmptyString(obj?.id);
      const callId = safeCallId(callIdCandidate || makeCallId("call_text", out.length));
      const argsRaw = inferArgsRaw(obj);

      out.push({
        call: { callId, name, argsRaw, index: out.length },
        warning: `Parsed tool call '${name}' from assistant plaintext output (fallback).`,
        line: line.slice(0, 600)
      });

      // Only allow one pattern match per line.
      break;
    }
  }

  return out;
}
