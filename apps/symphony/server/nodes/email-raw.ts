/**
 * email-raw — Source node (IMAP).
 *
 * Watches an IMAP mailbox via IDLE and emits each new email as a raw object
 * with individual fields (from, to, subject, date, body, html, …).
 *
 * Output ports:
 *   email : object — { from, to, cc, subject, date, body, html, messageId, inReplyTo, references }
 *
 * Config:
 *   host, port, secure, user, pass, mailbox — IMAP connection details
 *   maxBodyChars — truncation limit for text body
 */

import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { NodeFactory, SourceNodeContext, ScopedLogger } from "../types.js";

/** Extract .text from AddressObject | AddressObject[] | undefined. */
function addrText(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.map((a) => (a as { text?: string }).text ?? "").join(", ");
  return (v as { text?: string }).text ?? "";
}

/** Safely pull fields that @types/mailparser may omit depending on version. */
function rawFields(parsed: ParsedMail) {
  const p = parsed as Record<string, unknown>;
  const refs = p.references;
  return {
    cc: addrText(p.cc),
    inReplyTo: typeof p.inReplyTo === "string" ? p.inReplyTo : "",
    references: Array.isArray(refs) ? refs.join(", ") : (typeof refs === "string" ? refs : ""),
  };
}

export const factory: NodeFactory = {
  kind: "email-raw",
  label: "Email Raw (IMAP)",
  role: "source",
  description: "Watch an IMAP mailbox and emit raw email objects.",

  inputPorts: [],
  outputPorts: [
    {
      key: "email", label: "Email", type: "object",
      objectKeys: {
        from: "string", to: "string", cc: "string",
        subject: "string", date: "string",
        body: "string", html: "string",
        messageId: "string", inReplyTo: "string", references: "string",
      },
    },
  ],

  configSchema: [
    { key: "host",     label: "IMAP Host",       type: "string",  required: true, placeholder: "imap.gmail.com" },
    { key: "port",     label: "IMAP Port",        type: "number",  required: true, default: 993, placeholder: "993" },
    { key: "secure",   label: "Use TLS",          type: "boolean", default: true },
    { key: "user",     label: "Username",          type: "string",  required: true, placeholder: "user@example.com" },
    { key: "pass",     label: "Password",          type: "string",  required: true, sensitive: true },
    { key: "mailbox",  label: "Mailbox",           type: "string",  default: "INBOX", placeholder: "INBOX" },
    { key: "maxBodyChars", label: "Max Body Chars", type: "number",  default: 12000 },
  ],

  create(id, config) {
    let client: ImapFlow | null = null;
    let stopped = false;

    return {
      role: "source" as const,
      id,
      kind: "email-raw",

      async start(ctx: SourceNodeContext) {
        const host = String(config.host ?? "");
        const port = Number(config.port ?? 993);
        const secure = config.secure !== false;
        const user = String(config.user ?? "");
        const pass = String(config.pass ?? "");
        const mailbox = String(config.mailbox ?? "INBOX");
        const maxBodyChars = Number(config.maxBodyChars ?? 12000);

        if (!host || !user || !pass) {
          throw new Error("[email-raw] Missing host, user, or password");
        }

        client = new ImapFlow({
          host, port, secure,
          auth: { user, pass },
          logger: false,
        });

        client.on("error", (err: unknown) => {
          ctx.log.error("[email-raw] IMAP error:", fmtImapError(err));
        });

        stopped = false;
        ctx.log.info(`[email-raw] Connecting to ${user}@${host}:${port}/${mailbox}`);

        try {
          await client.connect();
        } catch (err: unknown) {
          const msg = fmtImapError(err);
          ctx.log.error("[email-raw] Connection failed:", msg);
          client = null;
          throw new Error(`[email-raw] Connection failed: ${msg}`);
        }

        void watchLoop(client, mailbox, maxBodyChars, ctx);
      },

      async stop() {
        stopped = true;
        if (client) {
          try { await client.logout(); } catch { /* ignore */ }
          client = null;
        }
      }
    };

    async function watchLoop(
      imap: ImapFlow,
      mailbox: string,
      maxBodyChars: number,
      ctx: SourceNodeContext,
    ): Promise<void> {
      const log = ctx.log;
      let backoff = 5_000;

      while (!stopped) {
        let lock;
        try {
          lock = await imap.getMailboxLock(mailbox);
        } catch (err: unknown) {
          log.error("[email-raw] Failed to lock mailbox:", (err as Error).message);
          if (stopped) return;
          await sleep(5000);
          continue;
        }

        try {
          let knownExists = imap.mailbox?.exists ?? 0;

          const onExists = async (data: { count?: number; prevCount?: number }) => {
            const newCount = data.count ?? 0;
            if (newCount <= knownExists) {
              knownExists = newCount;
              return;
            }

            const from = knownExists + 1;
            const to = newCount;
            knownExists = newCount;

            log.info(`[email-raw] ${to - from + 1} new message(s) detected`);

            try {
              for await (const msg of imap.fetch(`${from}:${to}`, { source: true, envelope: true })) {
                if (stopped) return;
                await processMessage(msg, maxBodyChars, ctx, log);
              }
            } catch (err: unknown) {
              log.error("[email-raw] Fetch error:", (err as Error).message);
            }
          };

          imap.on("exists", onExists);

          try {
            while (!stopped) {
              await imap.idle();
            }
          } catch {
            // IDLE interrupted — will reconnect if not stopped
          }

          imap.off("exists", onExists);
        } finally {
          lock.release();
        }

        if (!stopped) {
          log.warn(`[email-raw] IDLE ended, reconnecting in ${(backoff / 1000).toFixed(0)}s...`);
          await sleep(backoff);
          try {
            await imap.connect();
            backoff = 5_000; // reset on success
          } catch (err: unknown) {
            log.error("[email-raw] Reconnect failed:", (err as Error).message);
            backoff = Math.min(backoff * 2, 300_000); // cap at 5 min
          }
        }
      }
    }

    async function processMessage(
      msg: { uid: number; source?: Buffer; envelope?: { subject?: string } },
      maxBodyChars: number,
      ctx: SourceNodeContext,
      log: ScopedLogger,
    ): Promise<void> {
      try {
        if (!msg.source) {
          log.warn(`[email-raw] UID ${msg.uid}: no source, skipping`);
          return;
        }

        const parsed = await simpleParser(msg.source);

        let body = parsed.text ?? "";
        if (body.length > maxBodyChars) body = body.slice(0, maxBodyChars) + "…(truncated)";

        let html = typeof parsed.html === "string" ? parsed.html : "";
        if (html.length > maxBodyChars) html = html.slice(0, maxBodyChars) + "…(truncated)";

        const extra = rawFields(parsed);

        const email: Record<string, unknown> = {
          from: addrText(parsed.from),
          to: addrText(parsed.to),
          cc: extra.cc,
          subject: parsed.subject ?? "",
          date: parsed.date?.toISOString() ?? "",
          body,
          html,
          messageId: parsed.messageId ?? "",
          inReplyTo: extra.inReplyTo,
          references: extra.references,
        };

        log.info(`[email-raw] UID ${msg.uid}: "${parsed.subject ?? "(no subject)"}"`);
        ctx.emit({ email });
      } catch (err: unknown) {
        log.error(`[email-raw] UID ${msg.uid}: parse error:`, (err as Error).message);
      }
    }
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtImapError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  if (e.message) parts.push(String(e.message));
  if (e.responseStatus) parts.push(`status=${e.responseStatus}`);
  if (e.responseText) parts.push(String(e.responseText));
  if (e.code) parts.push(`code=${e.code}`);
  return parts.join(" — ") || String(err);
}
