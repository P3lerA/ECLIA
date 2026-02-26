import path from "node:path";
import * as fs from "node:fs";

import { loadEcliaConfig } from "@eclia/config";
import { env, explainFetchError } from "./utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SseEvent = { event: string; data: string };

export type TranscriptRecord =
  | {
      type: "assistant";
      text: string;
      toolCalls: any[];
      /** Internal: helpful for debugging adapter-side ordering issues. */
      reason: string;
    }
  | {
      type: "tool_result";
      callId: string;
      name: string;
      ok: boolean;
      result: any;
    };

// ---------------------------------------------------------------------------
// Gateway URL & auth
// ---------------------------------------------------------------------------

export function guessGatewayUrl(): string {
  const explicit = env("ECLIA_GATEWAY_URL");
  if (explicit) return explicit;
  const { config } = loadEcliaConfig(process.cwd());
  return `http://127.0.0.1:${config.api.port}`;
}

let cachedGatewayToken: string | null = null;

function readGatewayToken(): string {
  const explicit = env("ECLIA_GATEWAY_TOKEN");
  if (explicit) return explicit;

  try {
    const { rootDir } = loadEcliaConfig(process.cwd());
    const tokenPath = path.join(rootDir, ".eclia", "gateway.token");
    return fs.readFileSync(tokenPath, "utf-8").trim();
  } catch {
    return "";
  }
}

export function getGatewayToken(): string {
  if (cachedGatewayToken && cachedGatewayToken.trim()) return cachedGatewayToken;
  const t = readGatewayToken();
  if (t) cachedGatewayToken = t;
  return t;
}

export function withGatewayAuth(headers: Record<string, string>): Record<string, string> {
  const t = getGatewayToken();
  return t ? { ...headers, Authorization: `Bearer ${t}` } : headers;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export async function ensureGatewaySession(gatewayUrl: string, sessionId: string, title: string, origin: any) {
  const r = await fetch(`${gatewayUrl}/api/sessions`, {
    method: "POST",
    headers: withGatewayAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify({ id: sessionId, title, origin })
  });
  const j = (await r.json().catch(() => null)) as any;
  if (!j?.ok) throw new Error(`failed_to_create_session: ${j?.error ?? r.status}`);
  return j.session;
}

export async function resetGatewaySession(gatewayUrl: string, sessionId: string) {
  const r = await fetch(`${gatewayUrl}/api/sessions/${encodeURIComponent(sessionId)}/reset`, {
    method: "POST",
    headers: withGatewayAuth({ "Content-Type": "application/json" })
  });
  const j = (await r.json().catch(() => null)) as any;
  if (!j?.ok) throw new Error(`failed_to_reset_session: ${j?.error ?? r.status}`);
  return j.session;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

export function coerceStreamMode(v: unknown): "full" | "final" | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "full" || s === "final") return s;
  return null;
}

export async function* iterSse(resp: Response): AsyncGenerator<SseEvent> {
  if (!resp.body) return;
  const decoder = new TextDecoder();
  let buf = "";

  for await (const chunk of resp.body as any) {
    buf += decoder.decode(chunk, { stream: true });
    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx < 0) break;
      const part = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice("event:".length).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
      }
      yield { event, data: dataLines.join("\n") };
    }
  }
}

// ---------------------------------------------------------------------------
// runGatewayChat
// ---------------------------------------------------------------------------

export async function runGatewayChat(args: {
  gatewayUrl: string;
  sessionId: string;
  userText: string;
  model?: string;
  toolAccessMode?: "safe" | "full";
  streamMode?: "full" | "final";
  origin?: any;
  onRecord?: (record: TranscriptRecord) => Promise<void>;
}): Promise<{ text: string; meta?: any }> {
  let resp: Response;
  try {
    resp = await fetch(`${args.gatewayUrl}/api/chat`, {
      method: "POST",
      headers: withGatewayAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        sessionId: args.sessionId,
        userText: args.userText,
        model: args.model,
        toolAccessMode: args.toolAccessMode ?? "full",
        streamMode: args.streamMode ?? (args.onRecord ? "full" : "final"),
        origin: args.origin
      })
    });
  } catch (e: any) {
    throw new Error(`fetch_failed: ${explainFetchError(e)}`);
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`gateway_http_${resp.status}: ${t ? t.slice(0, 240) : resp.statusText}`);
  }

  const onRecord = typeof args.onRecord === "function" ? args.onRecord : null;

  // Serialize adapter-side record emissions to preserve ordering, but DO NOT
  // await within the SSE loop. Awaiting sends here can stall consumption of
  // the gateway response stream and trigger undici/Fetch "terminated" errors.
  let recordQueue: Promise<void> = Promise.resolve();
  const enqueueRecord = (rec: TranscriptRecord) => {
    if (!onRecord) return;
    recordQueue = recordQueue
      .then(() => onRecord(rec))
      .catch(() => {
        // Swallow adapter-side send failures.
      });
  };
  const drainRecords = async () => {
    if (!onRecord) return;
    await recordQueue;
  };

  let current = "";
  let lastCompleted = "";
  let finalText = "";
  let meta: any = undefined;

  // Record-level streaming state.
  let pendingAssistantText: string | null = null;
  let pendingAssistantToolCalls: any[] = [];
  let assistantFlushTimer: NodeJS.Timeout | null = null;
  const ASSISTANT_FLUSH_DELAY_MS = 250;

  const clearAssistantFlushTimer = () => {
    if (assistantFlushTimer) clearTimeout(assistantFlushTimer);
    assistantFlushTimer = null;
  };

  const flushAssistantRecord = (reason: string) => {
    clearAssistantFlushTimer();
    if (!onRecord) return;
    if (pendingAssistantText === null) return;

    const toolCalls = pendingAssistantToolCalls;
    const text = pendingAssistantText;

    pendingAssistantText = null;
    pendingAssistantToolCalls = [];

    enqueueRecord({ type: "assistant", text, toolCalls, reason });
  };

  const scheduleAssistantFlush = () => {
    if (!onRecord) return;
    clearAssistantFlushTimer();
    assistantFlushTimer = setTimeout(() => {
      flushAssistantRecord("debounce");
    }, ASSISTANT_FLUSH_DELAY_MS);
  };

  let sseError: any = null;
  try {
    for await (const ev of iterSse(resp)) {
      if (ev.event === "meta") {
        try { meta = JSON.parse(ev.data); } catch { /* ignore */ }
      }
      if (ev.event === "assistant_start") {
        flushAssistantRecord("assistant_start");
        current = "";
      }
      if (ev.event === "delta") {
        try {
          const j = JSON.parse(ev.data) as any;
          const text = typeof j?.text === "string" ? j.text : "";
          if (text) current += text;
        } catch {
          // ignore malformed chunks
        }
      }
      if (ev.event === "assistant_end") {
        lastCompleted = current;

        if (onRecord) {
          pendingAssistantText = current;
          current = "";
          scheduleAssistantFlush();
        }
      }
      if (ev.event === "tool_call") {
        if (onRecord) {
          try {
            const j = JSON.parse(ev.data) as any;
            pendingAssistantToolCalls.push(j);
            scheduleAssistantFlush();
          } catch {
            // ignore malformed tool_call blocks
          }
        }
      }
      if (ev.event === "tool_result") {
        if (onRecord) {
          flushAssistantRecord("tool_result");
          try {
            const j = JSON.parse(ev.data) as any;
            enqueueRecord({ type: "tool_result", ...j });
          } catch {
            enqueueRecord({
              type: "tool_result",
              name: "(unknown)",
              callId: "(unknown)",
              ok: false,
              result: { ok: false, error: { code: "bad_event", message: "Malformed tool_result event" } }
            });
          }
        }
      }
      if (ev.event === "final") {
        try {
          const j = JSON.parse(ev.data) as any;
          const text = typeof j?.text === "string" ? j.text : "";
          if (text) finalText = text;
        } catch {
          // ignore
        }
      }
      if (ev.event === "error") {
        if (onRecord) flushAssistantRecord("error");
        try {
          const j = JSON.parse(ev.data) as any;
          throw new Error(String(j?.message ?? "gateway_error"));
        } catch (e: any) {
          throw new Error(String(e?.message ?? e));
        }
      }
      if (ev.event === "done") {
        if (onRecord) flushAssistantRecord("done");
        break;
      }
    }
  } catch (e: any) {
    sseError = e;
  } finally {
    flushAssistantRecord("eof");
    await drainRecords();
  }

  if (sseError) throw sseError;

  const text = (finalText || lastCompleted || current).trim();
  return { text, meta };
}

// ---------------------------------------------------------------------------
// Artifact fetching
// ---------------------------------------------------------------------------

export async function fetchArtifactBytes(gatewayUrl: string, relPath: string): Promise<Buffer> {
  const u = new URL(`${gatewayUrl}/api/artifacts`);
  u.searchParams.set("path", relPath);
  const r = await fetch(u, { headers: withGatewayAuth({}) });
  if (!r.ok) throw new Error(`artifact_fetch_failed (${r.status})`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}
