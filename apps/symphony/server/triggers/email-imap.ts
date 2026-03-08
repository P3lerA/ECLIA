import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import type { TriggerSource, TriggerSourceContext } from "../types.js";

// ─── Public types ────────────────────────────────────────────

export interface EmailImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
  maxBodyChars: number;
}

export interface EmailPayload {
  mailbox: string;
  uid: number;
  messageId?: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  text?: string;
  attachments?: Array<{ filename?: string; type?: string; size?: number }>;
}

// ─── Factory ─────────────────────────────────────────────────

import type { TriggerSourceFactory } from "../types.js";

export const emailImapTriggerFactory: TriggerSourceFactory<EmailPayload> = {
  kind: "email-imap",
  label: "Email (IMAP)",
  configSchema: [
    { key: "host", label: "IMAP Host", type: "string", required: true, placeholder: "imap.gmail.com" },
    { key: "port", label: "IMAP Port", type: "number", required: true, default: 993, placeholder: "993" },
    { key: "secure", label: "Use TLS", type: "boolean", default: true },
    { key: "user", label: "Username", type: "string", required: true, placeholder: "user@example.com" },
    { key: "pass", label: "Password", type: "string", required: true, sensitive: true },
    { key: "mailbox", label: "Mailbox", type: "string", default: "INBOX", placeholder: "INBOX" },
    { key: "maxBodyChars", label: "Max Body Chars", type: "number", default: 12000 }
  ],
  create(id, raw) {
    const cfg = coerceConfig(raw);
    return new EmailImapTrigger(id, cfg);
  }
};

// ─── Implementation ──────────────────────────────────────────

class EmailImapTrigger implements TriggerSource<EmailPayload> {
  readonly id: string;
  readonly kind = "email-imap";

  private cfg: EmailImapConfig;
  private alive = false;
  private client: any = null;

  constructor(id: string, cfg: EmailImapConfig) {
    this.id = id;
    this.cfg = cfg;
  }

  async start(ctx: TriggerSourceContext<EmailPayload>): Promise<void> {
    this.alive = true;
    // Launch the long-running IMAP loop without blocking start().
    this.loop(ctx).catch((e) => {
      ctx.log.error("imap loop fatal:", String(e?.message ?? e));
    });
  }

  async stop(): Promise<void> {
    this.alive = false;
    if (this.client) {
      try { await this.client.logout(); } catch { /* ignore */ }
      this.client = null;
    }
  }

  // ── IMAP reconnect loop ────────────────────────────────────

  private async loop(ctx: TriggerSourceContext<EmailPayload>): Promise<void> {
    for (let attempt = 0; this.alive; attempt++) {
      try {
        await this.connect(ctx);
      } catch (e: any) {
        ctx.log.error("imap connect failed:", String(e?.message ?? e));
      }

      if (!this.alive) break;
      const backoff = Math.min(30_000, 1_000 * (attempt + 1));
      ctx.log.warn(`reconnecting in ${backoff}ms...`);
      await sleep(backoff);
    }
  }

  private async connect(ctx: TriggerSourceContext<EmailPayload>): Promise<void> {
    const client = new ImapFlow({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure,
      auth: { user: this.cfg.user, pass: this.cfg.pass },
      logger: false
    });

    let closedResolve: (() => void) | null = null;
    const closed = new Promise<void>((r) => { closedResolve = r; });

    client.on("error", (err: any) => ctx.log.error("imap error:", String(err?.message ?? err)));
    client.on("close", () => { ctx.log.warn("imap connection closed"); closedResolve?.(); });

    await client.connect();
    this.client = client;

    // Select mailbox to start IDLE.
    const lock = await client.getMailboxLock(this.cfg.mailbox, { readOnly: true });
    lock.release();

    ctx.log.info(`imap connected: ${this.cfg.host}:${this.cfg.port} [${this.cfg.mailbox}]`);

    // Bootstrap: record current tip so we only watch NEW mail.
    const lastUid = (await ctx.state.get<number>("lastUid")) ?? 0;
    if (lastUid === 0) {
      const mb = client.mailbox;
      const tip = mb && typeof mb.uidNext === "number"
        ? Math.max(0, Math.trunc(mb.uidNext) - 1)
        : 0;
      await ctx.state.set("lastUid", tip);
      ctx.log.info(`bootstrapped lastUid=${tip}`);
    }

    // Serialise syncs.
    let pending = false;
    let processing = Promise.resolve();
    const enqueue = (reason: string) => {
      pending = true;
      processing = processing
        .then(async () => { if (pending) { pending = false; await this.sync(client, ctx, reason); } })
        .catch((e) => ctx.log.error("sync error:", String(e?.message ?? e)));
    };

    client.on("exists", (data: any) => {
      if (typeof data?.count === "number" && typeof data?.prevCount === "number" && data.count <= data.prevCount) return;
      enqueue("exists");
    });

    enqueue("startup");
    await closed;
    this.client = null;
  }

  // ── Mailbox sync ───────────────────────────────────────────

  private async sync(client: any, ctx: TriggerSourceContext<EmailPayload>, reason: string): Promise<void> {
    const lastUid = (await ctx.state.get<number>("lastUid")) ?? 0;
    const start = Math.max(1, lastUid + 1);

    const lock = await client.getMailboxLock(this.cfg.mailbox, { readOnly: true });
    let fetched: Array<{ uid: number; payload: EmailPayload | null }> = [];
    try {
      const uids: number[] = await client.search({ uid: `${start}:*` }, { uid: true });
      if (!uids.length) { ctx.log.info(`no new mail (${reason})`); return; }
      uids.sort((a, b) => a - b);

      for (const uid of uids) {
        if (uid <= lastUid) continue;
        const payload = await fetchEmail(client, this.cfg.mailbox, uid, this.cfg.maxBodyChars);
        fetched.push({ uid, payload });
      }
    } finally {
      lock.release();
    }

    // Emit signals outside the IMAP lock.
    for (const entry of fetched) {
      if (entry.payload) {
        ctx.emit({ sourceId: this.id, timestamp: Date.now(), data: entry.payload });
      }
    }

    // Flush high-water mark once (not per-email) to avoid N disk writes per sync.
    if (fetched.length) {
      await ctx.state.set("lastUid", fetched[fetched.length - 1].uid);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchEmail(client: any, mailbox: string, uid: number, maxChars: number): Promise<EmailPayload | null> {
  const raw = await client.download(String(uid), undefined, { uid: true });
  if (!raw?.content) return null;

  const parsed = await simpleParser(raw.content);
  const text = parsed.text ?? "";
  const clipped = text.length > maxChars ? text.slice(0, maxChars) : text;

  return {
    mailbox,
    uid,
    messageId: parsed.messageId || undefined,
    subject: parsed.subject || undefined,
    date: parsed.date?.toISOString(),
    from: parsed.from?.text ?? "",
    to: typeof parsed.to === "string" ? parsed.to : Array.isArray(parsed.to) ? parsed.to.map((a) => a.text).join(", ") : parsed.to?.text ?? "",
    text: clipped,
    attachments: (parsed.attachments ?? []).slice(0, 10).map((a) => ({
      filename: a.filename || undefined,
      type: a.contentType || undefined,
      size: a.size || undefined
    }))
  };
}

function coerceConfig(raw: Record<string, unknown>): EmailImapConfig {
  const host = String(raw.host ?? "").trim();
  const port = Number(raw.port);
  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new Error("email-imap: invalid host/port");
  }
  return {
    host,
    port: Math.trunc(port),
    secure: Boolean(raw.secure ?? true),
    user: String(raw.user ?? "").trim(),
    pass: String(raw.pass ?? ""),
    mailbox: String(raw.mailbox ?? "INBOX").trim(),
    maxBodyChars: Number.isFinite(Number(raw.maxBodyChars)) ? Math.max(0, Math.trunc(Number(raw.maxBodyChars))) : 12_000
  };
}
