import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import type { SessionMetaV1 } from "./sessionTypes.js";
import type { SessionsIndexEventV1 } from "./sessionsIndexTypes.js";
import type { OpenAICompatMessage, TranscriptRecordV1, TranscriptTurnV1 } from "./transcriptTypes.js";

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

    // Ensure the global sessions index exists.
    const idx = this.sessionsIndexPath();
    if (!fs.existsSync(idx)) {
      await fsp.writeFile(idx, "", { encoding: "utf-8", flag: "a" });
    }
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

  private transcriptPath(sessionId: string): string {
    return path.join(this.dirFor(sessionId), "transcript.ndjson");
  }

  private sessionsIndexPath(): string {
    return path.join(this.sessionsDir, "sessions.ndjson");
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
    if (existing && existing.id) {
      // Ensure transcript file exists for older sessions (best-effort).
      const trPath = this.transcriptPath(sessionId);
      if (!fs.existsSync(trPath)) {
        await fsp.writeFile(trPath, "", { encoding: "utf-8", flag: "a" });
      }
      return coerceMeta(existing, sessionId);
    }

    const meta = seed ?? coerceMeta({ id: sessionId }, sessionId);
    await atomicWrite(metaFile, JSON.stringify(meta, null, 2));

    // Keep a global index for faster listing/lookup.
    await this.appendSessionsIndex({ v: 1, id: crypto.randomUUID(), ts: meta.updatedAt, type: "upsert", meta });

    // Ensure transcript file exists
    const trPath = this.transcriptPath(sessionId);
    if (!fs.existsSync(trPath)) {
      await fsp.writeFile(trPath, "", { encoding: "utf-8", flag: "a" });
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

  /**
   * Read the canonical transcript for a session.
   *
   * This returns the raw transcript records (msg/reset) as stored on disk.
   * UI can project these records as needed; the gateway uses them to rebuild
   * OpenAI-compatible context.
   */
  async readTranscript(sessionId: string): Promise<{ meta: SessionMetaV1; transcript: TranscriptRecordV1[] } | null> {
    await this.init();

    const sid = safeId(sessionId);
    if (!sid) return null;

    const meta = await readJsonFile<SessionMetaV1>(this.metaPath(sid));
    if (!meta) return null;

    const transcript = await this.readTranscriptRecords(sid);
    return { meta: coerceMeta(meta as any, sid), transcript };
  }

  async updateMeta(sessionId: string, patch: Partial<SessionMetaV1>): Promise<SessionMetaV1> {
    const current = await this.ensureSession(sessionId);
    const next: SessionMetaV1 = coerceMeta({ ...current, ...patch }, sessionId);
    await atomicWrite(this.metaPath(sessionId), JSON.stringify(next, null, 2));

    // Best-effort: append to global sessions index.
    await this.appendSessionsIndex({ v: 1, id: crypto.randomUUID(), ts: next.updatedAt, type: "upsert", meta: next });
    return next;
  }

  async resetSession(sessionId: string): Promise<SessionMetaV1> {
    await this.ensureSession(sessionId);
    await atomicWrite(this.transcriptPath(sessionId), "");
    const now = Date.now();
    const next = await this.updateMeta(sessionId, {
      title: "New session",
      createdAt: now,
      updatedAt: now
    });

    const resetTr: TranscriptRecordV1 = { v: 1, id: crypto.randomUUID(), ts: now, type: "reset" };
    await fsp.appendFile(this.transcriptPath(sessionId), JSON.stringify(resetTr) + "\n", "utf-8");

    // Best-effort: clear artifacts for this session (/.eclia/artifacts/<sessionId>/...).
    // Note: we intentionally do NOT clear /.eclia/debug (request captures) here.
    await this.clearSessionArtifacts(sessionId);

    return next;
  }

  /**
   * Permanently delete a session from disk.
   *
   * - Removes /.eclia/sessions/<sessionId>/...
   * - Best-effort clears /.eclia/artifacts/<sessionId>/...
   *
   * Note: we intentionally do NOT touch /.eclia/debug here.
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.init();

    const sid = safeId(sessionId);
    if (!sid) throw new Error("invalid_session_id");

    // Best-effort: clear artifacts first.
    await this.clearSessionArtifacts(sid);

    // Best-effort: append delete marker to global sessions index.
    await this.appendSessionsIndex({ v: 1, id: crypto.randomUUID(), ts: Date.now(), type: "delete", sessionId: sid });

    const dir = this.dirFor(sid);

    // Extra guard to ensure we never delete outside the sessions root.
    const absRoot = path.resolve(this.sessionsDir);
    const absTarget = path.resolve(dir);
    if (absTarget !== absRoot && !absTarget.startsWith(absRoot + path.sep)) {
      throw new Error("invalid_session_id");
    }

    await fsp.rm(absTarget, { recursive: true, force: true });
  }

  async appendTranscript(sessionId: string, msg: OpenAICompatMessage, ts?: number): Promise<void> {
    await this.ensureSession(sessionId);
    const rec: TranscriptRecordV1 = {
      v: 1,
      id: crypto.randomUUID(),
      ts: typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now(),
      type: "msg",
      msg
    };
    await fsp.appendFile(this.transcriptPath(sessionId), JSON.stringify(rec) + "\n", "utf-8");
  }

  async appendTurn(sessionId: string, turn: TranscriptTurnV1, ts?: number): Promise<void> {
    await this.ensureSession(sessionId);
    const rec: TranscriptRecordV1 = {
      v: 1,
      id: crypto.randomUUID(),
      ts: typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now(),
      type: "turn",
      turn: {
        tokenLimit: typeof (turn as any)?.tokenLimit === "number" ? (turn as any).tokenLimit : 0,
        usedTokens: typeof (turn as any)?.usedTokens === "number" ? (turn as any).usedTokens : 0
      }
    };
    await fsp.appendFile(this.transcriptPath(sessionId), JSON.stringify(rec) + "\n", "utf-8");
  }

  private async appendSessionsIndex(ev: SessionsIndexEventV1): Promise<void> {
    try {
      await this.init();
      await fsp.appendFile(this.sessionsIndexPath(), JSON.stringify(ev) + "\n", "utf-8");
    } catch {
      // Best-effort: index is non-critical.
    }
  }

  private async clearSessionArtifacts(sessionId: string): Promise<void> {
    const artifactsRoot = path.join(this.dataDir, "artifacts");
    const target = path.join(artifactsRoot, sessionId);

    // Extra guard (sessionId is already validated) to ensure we never delete outside the artifacts root.
    const absRoot = path.resolve(artifactsRoot);
    const absTarget = path.resolve(target);
    if (absTarget !== absRoot && !absTarget.startsWith(absRoot + path.sep)) return;

    try {
      await fsp.rm(absTarget, { recursive: true, force: true });
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      console.warn(`[sessionStore] Failed to clear artifacts for session ${sessionId}: ${msg}`);
    }
  }

  private async readTranscriptRecords(sessionId: string): Promise<TranscriptRecordV1[]> {
    const trPath = this.transcriptPath(sessionId);

    // Stream line-by-line for resilience (large sessions won't blow memory).
    let stream: fs.ReadStream;
    try {
      stream = fs.createReadStream(trPath, { encoding: "utf-8" });
    } catch {
      return [];
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const out: TranscriptRecordV1[] = [];

    try {
      for await (const line of rl) {
        const s = String(line ?? "").trim();
        if (!s) continue;

        try {
          const parsed = JSON.parse(s) as TranscriptRecordV1;
          if (!parsed || (parsed as any).v !== 1) continue;
          const t = (parsed as any).type;
          if (t !== "msg" && t !== "reset" && t !== "turn") continue;
          out.push(parsed);
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
