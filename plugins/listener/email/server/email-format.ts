import crypto from "node:crypto";

export type EmailNotifyTarget =
  | {
      kind: "discord";
      /** Discord channel id (snowflake). */
      channel_id: string;
    }
  | {
      kind: "telegram";
      /** Telegram chat id (user or group). */
      chat_id: string;
    };

export type EmailSummary = {
  mailbox: string;
  uid: number;
  messageId?: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  text?: string;
  attachments?: Array<{ filename?: string; type?: string; size?: number }>;
};

/**
 * Stable session id per account for auditability.
 *
 * NOTE: The email listener intentionally keeps the session transcript (no reset),
 * but each model request is sent with includeHistory=false so the model receives
 * no prior context.
 */
export function sessionIdForListenerEmail(accountId: string): string {
  const raw = String(accountId ?? "").trim() || "default";
  const safe = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  const base = safe || "default";
  const id = `listener_email_${base}`;
  // SessionStore regex allows up to 120 chars.
  return id.length <= 120 ? id : id.slice(0, 120);
}

function shortenTitle(s: string): string {
  return s.length > 96 ? s.slice(0, 96).trimEnd() + "…" : s;
}

/**
 * Human-readable session title shown in web console menus.
 * Rule: Listener-Email: ID-User (fallback to ID when user is empty).
 */
export function sessionTitleForListenerEmail(accountId: string, user: string): string {
  const id = String(accountId ?? "").trim() || "default";
  const u = String(user ?? "").trim();
  const base = u ? `${id}-${u}` : id;
  return shortenTitle(`Listener-Email: ${base}`);
}

export function originFromNotifyTarget(target: EmailNotifyTarget): any {
  if (target.kind === "discord") {
    return { kind: "discord", channelId: String(target.channel_id ?? "").trim() };
  }
  return { kind: "telegram", chatId: String(target.chat_id ?? "").trim() };
}

function fmtAttachments(atts: EmailSummary["attachments"]): string {
  if (!Array.isArray(atts) || !atts.length) return "(none)";
  const parts = atts.slice(0, 10).map((a) => {
    const name = String(a?.filename ?? "").trim() || "attachment";
    const type = String(a?.type ?? "").trim();
    const size = typeof a?.size === "number" && Number.isFinite(a.size) ? `${Math.trunc(a.size)}B` : "";
    return [name, type, size].filter(Boolean).join(" ");
  });
  return parts.join("; ") + (atts.length > 10 ? ` (+${atts.length - 10} more)` : "");
}

export function buildTriagePrompt(args: {
  template: string;
  criterion: string;
  email: EmailSummary;
  maxBodyChars: number;
}): string {
  const e = args.email;

  const bodyRaw = String(e.text ?? "");
  const max = Number.isFinite(args.maxBodyChars) ? Math.max(0, Math.trunc(args.maxBodyChars)) : 12_000;
  const body = bodyRaw.length > max ? bodyRaw.slice(0, max) + `\n\n...[truncated ${bodyRaw.length - max} chars]` : bodyRaw;

  const msgId = String(e.messageId ?? "").trim();
  const idLine = msgId ? msgId : `uid:${e.uid}`;

  const vars: Record<string, string> = {
    criterion: String(args.criterion ?? "").trim() || "(empty rule; be conservative and ignore unless clearly important)",
    mailbox: e.mailbox,
    uid: String(e.uid),
    message_id: idLine,
    from: String(e.from ?? "").trim(),
    to: String(e.to ?? "").trim(),
    subject: String(e.subject ?? "").trim(),
    date: String(e.date ?? "").trim(),
    attachments: fmtAttachments(e.attachments),
    body: body.trim() ? body : "(no text body)"
  };

  return args.template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export function randomRequestId(): string {
  return crypto.randomUUID();
}
