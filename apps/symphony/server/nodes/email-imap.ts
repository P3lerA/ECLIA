/**
 * email-imap — Source node.
 *
 * Watches an IMAP mailbox via IDLE and emits new emails as formatted text
 * on the "text" output port.
 *
 * Output ports:
 *   text : string — formatted email content (optionally wrapped by user prompt template)
 *
 * Config:
 *   host, port, secure, user, pass, mailbox — IMAP connection details
 *   maxBodyChars — truncation limit for email body
 *   userPrompt   — (connectable) template wrapping the email; use {{EMAIL_CONTENT}} placeholder
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { NodeFactory, SourceNodeContext, ScopedLogger } from "../types.js";

// ── helpers ──────────────────────────────────────────────────

function formatEmail(parsed: {
  from?: { text?: string };
  to?: { text?: string };
  subject?: string;
  date?: Date;
  text?: string;
}, maxChars: number): string {
  const lines: string[] = [];
  if (parsed.from?.text) lines.push(`From: ${parsed.from.text}`);
  if (parsed.to?.text) lines.push(`To: ${parsed.to.text}`);
  if (parsed.subject) lines.push(`Subject: ${parsed.subject}`);
  if (parsed.date) lines.push(`Date: ${parsed.date.toISOString()}`);
  lines.push(""); // blank separator

  let body = parsed.text ?? "(no text body)";
  if (body.length > maxChars) body = body.slice(0, maxChars) + "…(truncated)";
  lines.push(body);
  return lines.join("\n");
}

function applyTemplate(template: string, emailContent: string): string {
  if (!template.trim()) return emailContent;
  if (template.includes("{{EMAIL_CONTENT}}")) {
    return template.replace(/\{\{EMAIL_CONTENT\}\}/g, emailContent);
  }
  // No placeholder — append content after template
  return template + "\n\n" + emailContent;
}

// ── factory ──────────────────────────────────────────────────

export const factory: NodeFactory = {
  kind: "email-imap",
  label: "Email (IMAP)",
  role: "source",
  description: "Watch an IMAP mailbox for new emails.",

  inputPorts: [],
  outputPorts: [
    { key: "text", label: "Text", type: "string" }
  ],

  configSchema: [
    { key: "host",     label: "IMAP Host",        type: "string",  required: true, placeholder: "imap.gmail.com" },
    { key: "port",     label: "IMAP Port",         type: "number",  required: true, default: 993, placeholder: "993" },
    { key: "secure",   label: "Use TLS",           type: "boolean", default: true },
    { key: "user",     label: "Username",           type: "string",  required: true, placeholder: "user@example.com" },
    { key: "pass",     label: "Password",           type: "string",  required: true, sensitive: true },
    { key: "mailbox",  label: "Mailbox",            type: "string",  default: "INBOX", placeholder: "INBOX" },
    { key: "maxBodyChars", label: "Max Body Chars",  type: "number",  default: 12000 },
    { key: "userPrompt", label: "User Prompt", type: "text", placeholder: "Wrap email: {{EMAIL_CONTENT}}" },
  ],

  create(id, config) {
    let client: ImapFlow | null = null;
    let stopped = false;

    return {
      role: "source" as const,
      id,
      kind: "email-imap",

      async start(ctx: SourceNodeContext) {
        const host = String(config.host ?? "");
        const port = Number(config.port ?? 993);
        const secure = config.secure !== false;
        const user = String(config.user ?? "");
        const pass = String(config.pass ?? "");
        const mailbox = String(config.mailbox ?? "INBOX");
        const maxBodyChars = Number(config.maxBodyChars ?? 12000);
        const userPrompt = typeof config.userPrompt === "string" ? config.userPrompt : "";

        if (!host || !user || !pass) {
          throw new Error("[email-imap] Missing host, user, or password");
        }

        client = new ImapFlow({
          host, port, secure,
          auth: { user, pass },
          logger: false,
        });

        client.on("error", (err: unknown) => {
          ctx.log.error("[email-imap] IMAP error:", fmtImapError(err));
        });

        stopped = false;
        ctx.log.info(`[email-imap] Connecting to ${user}@${host}:${port}/${mailbox}`);

        try {
          await client.connect();
        } catch (err: unknown) {
          const msg = fmtImapError(err);
          ctx.log.error("[email-imap] Connection failed:", msg);
          client = null;
          throw new Error(`[email-imap] Connection failed: ${msg}`);
        }

        // Run the IDLE watch loop in background (don't await — returns when stopped)
        void watchLoop(client, mailbox, maxBodyChars, userPrompt, ctx);
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
      userPrompt: string,
      ctx: SourceNodeContext,
    ): Promise<void> {
      const log = ctx.log;

      while (!stopped) {
        let lock;
        try {
          lock = await imap.getMailboxLock(mailbox);
        } catch (err: unknown) {
          log.error("[email-imap] Failed to lock mailbox:", (err as Error).message);
          if (stopped) return;
          await sleep(5000);
          continue;
        }

        try {
          // Track current count so we detect new arrivals
          let knownExists = imap.mailbox?.exists ?? 0;

          // Listen for new messages (imapflow emits { path, count, prevCount })
          const onExists = async (data: { count?: number; prevCount?: number }) => {
            const newCount = data.count ?? 0;
            if (newCount <= knownExists) {
              knownExists = newCount;
              return;
            }

            const from = knownExists + 1;
            const to = newCount;
            knownExists = newCount;

            log.info(`[email-imap] ${to - from + 1} new message(s) detected`);

            try {
              for await (const msg of imap.fetch(`${from}:${to}`, { source: true, envelope: true })) {
                if (stopped) return;
                await processMessage(msg, maxBodyChars, userPrompt, ctx, log);
              }
            } catch (err: unknown) {
              log.error("[email-imap] Fetch error:", (err as Error).message);
            }
          };

          imap.on("exists", onExists);

          // Enter IDLE — this blocks until the connection drops or we stop
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
          log.warn("[email-imap] IDLE ended, reconnecting in 5s...");
          await sleep(5000);
          try {
            await imap.connect();
          } catch (err: unknown) {
            log.error("[email-imap] Reconnect failed:", (err as Error).message);
          }
        }
      }
    }

    async function processMessage(
      msg: { uid: number; source?: Buffer; envelope?: { subject?: string } },
      maxBodyChars: number,
      userPrompt: string,
      ctx: SourceNodeContext,
      log: ScopedLogger,
    ): Promise<void> {
      try {
        if (!msg.source) {
          log.warn(`[email-imap] UID ${msg.uid}: no source, skipping`);
          return;
        }

        const parsed = await simpleParser(msg.source);
        const formatted = formatEmail(parsed, maxBodyChars);
        const output = applyTemplate(userPrompt, formatted);

        log.info(`[email-imap] UID ${msg.uid}: "${parsed.subject ?? "(no subject)"}"`);
        ctx.emit({ text: output });
      } catch (err: unknown) {
        log.error(`[email-imap] UID ${msg.uid}: parse error:`, (err as Error).message);
      }
    }
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extract useful detail from imapflow errors (they often carry responseStatus/responseText). */
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
