import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import type { SessionDetail, SessionEventV1, SessionMetaV1, StoredMessage } from "./sessionTypes.js";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,120}$/;

function safeId(id: string): string | null {
  const s = (id ?? "").trim();
  if (!s) return null;
  if (!SAFE_ID.test(s)) return null;
  // disallow path traversal just in case
  if (s.includes("..")) return null;
  return s;
}

async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const txt = await fsp.readFile(filePath, "utf-8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`);
  await fsp.writeFile(tmp, content, "utf-8");
  // rename is atomic on POSIX; on Windows it's effectively atomic for our use case.
  await fsp.rename(tmp, filePath);
}

function coerceMeta(v: any, fallbackId: string): SessionMetaV1 {
  const now = Date.now();
  const id = typeof v?.id === "string" ? v.id : fallbackId;
  return {
    v: 1,
    id,
    title: typeof v?.title === "string" && v.title.trim() ? v.title : "New session",
    createdAt: typeof v?.createdAt === "number" ? v.createdAt : now,
    updatedAt: typeof v?.updatedAt === "number" ? v.updatedAt : now,
    origin: v?.origin && typeof v.origin === "object" ? v.origin : undefined,
    lastModel: typeof v?.lastModel === "string" ? v.lastModel : undefined
  };
}

export class SessionStore {
  readonly sessionsDir: string;

  constructor(private dataDir: string) {
    this.sessionsDir = path.join(dataDir, "sessions");
  }

  async init(): Promise<void> {
    await ensureDir(this.sessionsDir);
  }

  /**
   * Validate a session id before doing any filesystem operations.
   * Useful for routers so they can return 400 (vs 404) on malformed ids.
   */
  isValidSessionId(sessionId: string): boolean {
    return Boolean(safeId(sessionId));
  }

  private dirFor(sessionId: string): string {
    const sid = safeId(sessionId);
    if (!sid) throw new Error("invalid_session_id");
    return path.join(this.sessionsDir, sid);
  }

  private metaPath(sessionId: string): string {
    return path.join(this.dirFor(sessionId), "meta.json");
  }

  private eventsPath(sessionId: string): string {
    return path.join(this.dirFor(sessionId), "events.ndjson");
  }

  async createSession(title?: string): Promise<SessionMetaV1> {
    const id = crypto.randomUUID().replace(/-/g, "_");
    const now = Date.now();
    const meta: SessionMetaV1 = {
      v: 1,
      id,
      title: title && title.trim() ? title.trim() : "New session",
      createdAt: now,
      updatedAt: now
    };

    await this.ensureSession(id, meta);
    return meta;
  }

  async ensureSession(sessionId: string, seed?: SessionMetaV1): Promise<SessionMetaV1> {
    const dir = this.dirFor(sessionId);
    await ensureDir(dir);

    const metaFile = this.metaPath(sessionId);
    const existing = await readJsonFile<SessionMetaV1>(metaFile);
    if (existing && existing.id) return coerceMeta(existing, sessionId);

    const meta = seed ?? coerceMeta({ id: sessionId }, sessionId);
    await atomicWrite(metaFile, JSON.stringify(meta, null, 2));
    // Ensure events file exists
    const evPath = this.eventsPath(sessionId);
    if (!fs.existsSync(evPath)) {
      await fsp.writeFile(evPath, "", { encoding: "utf-8", flag: "a" });
    }
    return meta;
  }

  async listSessions(limit: number = 200): Promise<SessionMetaV1[]> {
    await this.init();
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(this.sessionsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const metas: SessionMetaV1[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const id = e.name;
      if (!safeId(id)) continue;

      const meta = await readJsonFile<SessionMetaV1>(path.join(this.sessionsDir, id, "meta.json"));
      if (!meta) continue;
      metas.push(coerceMeta(meta as any, id));
    }

    metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return metas.slice(0, Math.max(1, Math.min(2000, limit)));
  }

  async readSession(sessionId: string, opts?: { includeTools?: boolean }): Promise<SessionDetail | null> {
    await this.init();

    const sid = safeId(sessionId);
    if (!sid) return null;

    const meta = await readJsonFile<SessionMetaV1>(this.metaPath(sid));
    if (!meta) {
      // session may not exist yet
      return null;
    }

    const events = await this.readEvents(sid);
    const includeTools = Boolean(opts?.includeTools);

    const messages: StoredMessage[] = [];
    let lastMsg: StoredMessage | null = null;

    for (const ev of events) {
      if (!ev || (ev as any).v !== 1) continue;

      if (ev.type === "reset") {
        // Future-proofing: if we ever stop truncating the file on reset,
        // treat reset as a hard boundary in the projection.
        messages.length = 0;
        lastMsg = null;
        continue;
      }

      if (ev.type === "message" && ev.message) {
        const msg = ev.message;
        // Defensive: ensure blocks exist.
        (msg as any).blocks = Array.isArray((msg as any).blocks) ? (msg as any).blocks : [];
        messages.push(msg);
        lastMsg = msg;
        continue;
      }

      if (!includeTools) continue;

      if (ev.type === "tool_call" && (ev as any).call) {
        const call = (ev as any).call as any;
        const name = typeof call?.name === "string" ? call.name : "tool";
        const argsRaw = typeof call?.argsRaw === "string" ? call.argsRaw : "";
        const callId = typeof call?.callId === "string" ? call.callId : "";

        const block = {
          type: "tool" as const,
          name,
          status: "calling" as const,
          payload: { callId, raw: argsRaw }
        };

        if (lastMsg && lastMsg.role === "assistant") {
          lastMsg.blocks.push(block as any);
        } else {
          const toolMsg: StoredMessage = {
            id: crypto.randomUUID(),
            role: "tool",
            createdAt: ev.ts,
            blocks: [block as any]
          };
          messages.push(toolMsg);
          lastMsg = toolMsg;
        }
        continue;
      }

      if (ev.type === "tool_result" && (ev as any).result) {
        const result = (ev as any).result as any;
        const name = typeof result?.name === "string" ? result.name : "tool";
        const callId = typeof result?.callId === "string" ? result.callId : "";
        const ok = Boolean(result?.ok);
        const output = result?.output;

        const block = {
          type: "tool" as const,
          name,
          status: ok ? ("ok" as const) : ("error" as const),
          payload: { callId, ok, output }
        };

        if (lastMsg && lastMsg.role === "assistant") {
          lastMsg.blocks.push(block as any);
        } else {
          const toolMsg: StoredMessage = {
            id: crypto.randomUUID(),
            role: "tool",
            createdAt: ev.ts,
            blocks: [block as any]
          };
          messages.push(toolMsg);
          lastMsg = toolMsg;
        }
        continue;
      }
    }

    // Keep a chronological view for the UI.
    // Do a stable sort for deterministic ordering even if timestamps collide.
    const stable = messages.map((m, i) => ({ m, i }));
    stable.sort((a, b) => (a.m.createdAt - b.m.createdAt) || (a.i - b.i));

    return { meta: coerceMeta(meta as any, sid), messages: stable.map((x) => x.m) };
  }

  async appendEvent(sessionId: string, ev: SessionEventV1, opts?: { touchMeta?: boolean }): Promise<void> {
    await this.ensureSession(sessionId);

    const line = JSON.stringify(ev);
    await fsp.appendFile(this.eventsPath(sessionId), line + "\n", "utf-8");

    // In many hot paths (chat streaming + tool loops), callers may choose to
    // batch meta updates to avoid excessive atomic rewrites of meta.json.
    if (opts?.touchMeta === false) return;

    // Update meta.updatedAt (best-effort).
    const metaFile = this.metaPath(sessionId);
    const meta = await readJsonFile<SessionMetaV1>(metaFile);
    if (meta) {
      meta.updatedAt = Math.max(meta.updatedAt ?? 0, ev.ts);
      await atomicWrite(metaFile, JSON.stringify(coerceMeta(meta as any, sessionId), null, 2));
    }
  }

  async updateMeta(sessionId: string, patch: Partial<SessionMetaV1>): Promise<SessionMetaV1> {
    const current = await this.ensureSession(sessionId);
    const next: SessionMetaV1 = coerceMeta({ ...current, ...patch }, sessionId);
    await atomicWrite(this.metaPath(sessionId), JSON.stringify(next, null, 2));
    return next;
  }

  async resetSession(sessionId: string): Promise<SessionMetaV1> {
    const meta = await this.ensureSession(sessionId);
    await atomicWrite(this.eventsPath(sessionId), "");
    const now = Date.now();
    const next = await this.updateMeta(sessionId, {
      title: "New session",
      createdAt: now,
      updatedAt: now
    });

    // Write an explicit reset event (helps debugging and future replays).
    const resetEv: SessionEventV1 = { v: 1, id: crypto.randomUUID(), ts: now, type: "reset" };
    await fsp.appendFile(this.eventsPath(sessionId), JSON.stringify(resetEv) + "\n", "utf-8");

    return next;
  }

  private async readEvents(sessionId: string): Promise<SessionEventV1[]> {
    const evPath = this.eventsPath(sessionId);

    // Stream line-by-line for resilience (large sessions won't blow memory).
    let stream: fs.ReadStream;
    try {
      stream = fs.createReadStream(evPath, { encoding: "utf-8" });
    } catch {
      return [];
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const out: SessionEventV1[] = [];

    try {
      for await (const line of rl) {
        const s = String(line ?? "").trim();
        if (!s) continue;

        try {
          const parsed = JSON.parse(s) as SessionEventV1;
          // Minimal shape check
          if (parsed && (parsed as any).v === 1 && typeof (parsed as any).type === "string") out.push(parsed);
        } catch {
          // If a line is truncated/corrupted (crash while writing), ignore it.
          continue;
        }
      }
    } finally {
      rl.close();
      stream.close();
    }

    return out;
  }
}
