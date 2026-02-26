import type { Message, Session } from "../types";
import { apiFetch } from "./apiFetch";

export type SessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastModel?: string;
  // Optional extra metadata returned by the gateway.
  // Keep optional for compatibility with older gateways.
  messageCount?: number;
};

export type ListSessionsResponse =
  | { ok: true; sessions: SessionMeta[] }
  | { ok: false; error: string; hint?: string };

export type CreateSessionResponse =
  | { ok: true; session: SessionMeta }
  | { ok: false; error: string; hint?: string };

export type GetSessionResponse =
  | { ok: true; session: SessionMeta; transcript: TranscriptRecord[] }
  | { ok: false; error: string; hint?: string };

export type ResetSessionResponse =
  | { ok: true; session: SessionMeta }
  | { ok: false; error: string; hint?: string };

export type DeleteSessionResponse =
  | { ok: true }
  | { ok: false; error: string; hint?: string };

export async function apiListSessions(limit = 200): Promise<SessionMeta[]> {
  const url = `/api/sessions?limit=${encodeURIComponent(String(limit))}`;
  const r = await apiFetch(url, { method: "GET" });
  const j = (await r.json()) as ListSessionsResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.sessions;
}

export async function apiCreateSession(
  arg?: string | { title?: string; id?: string }
): Promise<SessionMeta> {
  const payload: any = {};
  // Let the gateway know this session is attached to the web console.
  // (Tools like `send` can use this metadata to route outputs later.)
  payload.origin = { kind: "web" };
  if (typeof arg === "string") {
    payload.title = arg;
  } else if (arg && typeof arg === "object") {
    if (typeof arg.title === "string" && arg.title.trim()) payload.title = arg.title;
    if (typeof arg.id === "string" && arg.id.trim()) payload.id = arg.id;
  }

  const r = await apiFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = (await r.json()) as CreateSessionResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.session;
}

export async function apiGetSession(sessionId: string): Promise<{ session: SessionMeta; messages: Message[] }> {
  const r = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
  const j = (await r.json()) as GetSessionResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return { session: j.session, messages: transcriptToMessages(j.transcript) };
}

// ---- Transcript types (mirrors gateway/server/transcriptTypes.ts) ----

type OpenAICompatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAICompatMessage =
  | { role: "system"; content: any }
  | { role: "user"; content: any }
  | { role: "assistant"; content: any; tool_calls?: OpenAICompatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: any };

type TranscriptTurn = {
  turnId?: string;
  tokenLimit: number;
  usedTokens: number;
  upstream?: { routeKey: string; model: string; baseUrl: string };
  git?: { commit: string | null; branch: string | null; dirty: boolean | null };
  runtime?: { temperature: number | null; topP: number | null; topK: number | null; maxOutputTokens: number | null };
  toolAccessMode?: "full" | "safe";
};

type TranscriptRecord =
  | { v: 1; id: string; ts: number; type: "msg"; msg: OpenAICompatMessage }
  | { v: 1; id: string; ts: number; type: "reset" }
  | { v: 1; id: string; ts: number; type: "turn"; turn: TranscriptTurn };

function transcriptToMessages(records: TranscriptRecord[]): Message[] {
  const out: Message[] = [];

  // Map tool_call_id -> tool name (from the assistant tool_calls).
  // This lets us render tool result bubbles with stable names.
  const callIdToName = new Map<string, string>();

  const safeRecords = Array.isArray(records) ? records : [];

  for (const r of safeRecords) {
    if (!r || (r as any).v !== 1) continue;

    if ((r as any).type === "reset") {
      out.length = 0;
      callIdToName.clear();
      continue;
    }

    // Turn marker is a persistence-only record; UI can use it later for grouping,
    // but for now we keep the chat timeline message-only.
    if ((r as any).type === "turn") {
      continue;
    }

    if ((r as any).type !== "msg" || !(r as any).msg) continue;
    const m = (r as any).msg as OpenAICompatMessage;
    const ts = typeof (r as any).ts === "number" ? (r as any).ts : Date.now();

    if (m.role === "user") {
      const text = typeof (m as any).content === "string" ? String((m as any).content) : safeJson((m as any).content);
      out.push({ id: (r as any).id ?? cryptoId(), role: "user", createdAt: ts, blocks: [{ type: "text", text }], raw: text });
      continue;
    }

    if (m.role === "assistant") {
      const raw = typeof (m as any).content === "string" ? String((m as any).content) : safeJson((m as any).content);
      const blocks = blocksFromAssistantRaw(raw);

      // Render tool calls *inside* the assistant bubble. This matches OpenAI semantics:
      // tool_calls belong to the assistant message, while tool results are separate role=tool messages.
      const toolCalls = Array.isArray((m as any).tool_calls) ? ((m as any).tool_calls as OpenAICompatToolCall[]) : [];
      for (const tc of toolCalls) {
        const callId = typeof tc?.id === "string" ? tc.id : "";
        const name = typeof tc?.function?.name === "string" ? tc.function.name : "tool";
        const argsRaw = typeof tc?.function?.arguments === "string" ? tc.function.arguments : "";

        if (callId) callIdToName.set(callId, name);

        // Best-effort parse for richer UI display (parse errors are surfaced).
        let parsed: any = null;
        let parseError: string | undefined;
        try {
          parsed = argsRaw ? JSON.parse(argsRaw) : {};
        } catch (e: any) {
          parsed = {};
          parseError = String(e?.message ?? e);
        }

        blocks.push({
          type: "tool",
          name,
          status: "calling",
          payload: { callId, raw: argsRaw, parsed, parseError }
        } as any);
      }

      out.push({ id: (r as any).id ?? cryptoId(), role: "assistant", createdAt: ts, blocks, raw });
      continue;
    }

    if (m.role === "tool") {
      const callId = typeof (m as any).tool_call_id === "string" ? String((m as any).tool_call_id) : "";
      const content = (m as any).content;
      const raw = typeof content === "string" ? content : safeJson(content);
      const parsed = tryParseJson(raw);

      // Best-effort: tool result payloads are usually JSON.
      const ok = typeof (parsed as any)?.ok === "boolean" ? Boolean((parsed as any).ok) : undefined;
      const status: "ok" | "error" = ok === false ? "error" : "ok";

      const name = callId ? callIdToName.get(callId) ?? "tool" : "tool";
      out.push({
        id: (r as any).id ?? cryptoId(),
        role: "tool",
        createdAt: ts,
        blocks: [{ type: "tool", name, status, payload: { callId, ok: ok ?? true, output: parsed } } as any],
        raw
      });
      continue;
    }

    if (m.role === "system") {
      const text = typeof (m as any).content === "string" ? String((m as any).content) : safeJson((m as any).content);
      out.push({ id: (r as any).id ?? cryptoId(), role: "system", createdAt: ts, blocks: [{ type: "text", text }], raw: text });
      continue;
    }
  }

  return out;
}

function blocksFromAssistantRaw(raw: string) {
  const { thoughts, visible } = splitThink(raw);
  const blocks: any[] = [];
  for (const t of thoughts) blocks.push({ type: "thought", text: t, visibility: "internal" });
  blocks.push({ type: "text", text: visible ?? "" });
  return blocks;
}

function splitThink(raw: string): { thoughts: string[]; visible: string } {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return { thoughts: [], visible: "" };
  const re = /<think>([\s\S]*?)<\/think>/gi;
  const thoughts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const inner = (m[1] ?? "").trim();
    if (inner) thoughts.push(inner);
  }
  const visible = s.replace(re, "").trim();
  return { thoughts, visible };
}

function tryParseJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function cryptoId(): string {
  // Avoid pulling in crypto just for UI ids.
  return `ui_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export async function apiResetSession(sessionId: string): Promise<SessionMeta> {
  const r = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const j = (await r.json()) as ResetSessionResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.session;
}

export async function apiDeleteSession(sessionId: string): Promise<void> {
  const r = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  const j = (await r.json()) as DeleteSessionResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
}

/**
 * Convert a gateway SessionMeta into the UI Session shape.
 * UI uses a human-friendly meta string for now.
 */
export function toUiSession(meta: SessionMeta): Session {
  const started = typeof meta.messageCount === "number" ? meta.messageCount > 0 : undefined;
  return {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    meta: formatSessionMeta(meta.updatedAt),
    started
  };
}

function formatSessionMeta(updatedAt: number): string {
  const now = Date.now();
  const d = Math.max(0, now - updatedAt);

  if (d < 10_000) return "just now";
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;

  const dt = new Date(updatedAt);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
