/**
 * email-imap — Source node.
 *
 * Watches an IMAP mailbox via IDLE and emits new emails
 * on the "email" output port.
 *
 * Output ports:
 *   email : object  — { uid, from, to, subject, date, text, attachments }
 */

import type { NodeFactory } from "../types.js";

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

export const emailImapFactory: NodeFactory = {
  kind: "email-imap",
  label: "Email (IMAP)",
  role: "source",
  description: "Watch an IMAP mailbox for new emails.",

  inputPorts: [],
  outputPorts: [
    { key: "email", label: "Email", type: "object" }
  ],

  configSchema: [
    { key: "host",     label: "IMAP Host",        type: "string",  required: true, placeholder: "imap.gmail.com" },
    { key: "port",     label: "IMAP Port",         type: "number",  required: true, default: 993, placeholder: "993" },
    { key: "secure",   label: "Use TLS",           type: "boolean", default: true },
    { key: "user",     label: "Username",           type: "string",  required: true, placeholder: "user@example.com" },
    { key: "pass",     label: "Password",           type: "string",  required: true, sensitive: true },
    { key: "mailbox",  label: "Mailbox",            type: "string",  default: "INBOX", placeholder: "INBOX" },
    { key: "maxBodyChars", label: "Max Body Chars",  type: "number",  default: 12000 }
  ],

  create(id, config) {
    let client: any = null;

    return {
      role: "source" as const,
      id,
      kind: "email-imap",

      async start(ctx) {
        // TODO: port the full IMAP IDLE loop from the old EmailImapTrigger.
        // The shape is identical — connect, lock mailbox, listen for "exists",
        // fetch new emails, call ctx.emit({ email: payload }).
        ctx.log.info(`[email-imap] would start watching ${config.user}@${config.host}:${config.port}/${config.mailbox}`);
      },

      async stop() {
        if (client) {
          try { await client.logout(); } catch { /* ignore */ }
          client = null;
        }
      }
    };
  }
};
