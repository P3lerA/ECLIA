import fsp from "node:fs/promises";
import path from "node:path";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { loadEcliaConfig } from "@eclia/config";

import { makeAdapterLogger } from "../../../../apps/adapter/utils.js";
import { ensureGatewaySession, guessGatewayUrl, runGatewayChat } from "../../../../apps/adapter/gateway.js";

import {
  buildTriagePrompt,
  originFromNotifyTarget,
  sessionIdForListenerEmail,
  sessionTitleForListenerEmail,
  type EmailNotifyTarget,
  type EmailSummary
} from "./email-format.js";

const log = makeAdapterLogger("listener-email");

type EmailListenerAccountConfig = {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  mailbox: string;
  criterion: string;
  model?: string;
  notify: EmailNotifyTarget;
  max_body_chars: number;
};

type AccountStateV1 = { v: 1; lastUid: number };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function coerceAccount(raw: any, fallbackId: string): EmailListenerAccountConfig | null {
  const id = asStr(raw?.id).trim() || fallbackId;
  const host = asStr(raw?.host).trim();
  const port = Number(raw?.port);
  const secure = Boolean(raw?.secure ?? true);
  const user = asStr(raw?.user).trim();
  const pass = asStr(raw?.pass).trim() || undefined;
  const mailbox = asStr(raw?.mailbox).trim() || "INBOX";
  const criterion = asStr(raw?.criterion).trim();
  const model = asStr(raw?.model).trim() || undefined;
  const max_body_chars = Number.isFinite(Number(raw?.max_body_chars)) ? Math.max(0, Math.trunc(Number(raw?.max_body_chars))) : 12_000;

  const notifyKind = asStr(raw?.notify?.kind).trim().toLowerCase();
  let notify: EmailNotifyTarget | null = null;
  if (notifyKind === "discord") {
    const channel_id = asStr(raw?.notify?.channel_id ?? raw?.notify?.channelId).trim();
    if (channel_id) notify = { kind: "discord", channel_id };
  } else if (notifyKind === "telegram") {
    const chat_id = asStr(raw?.notify?.chat_id ?? raw?.notify?.chatId).trim();
    if (chat_id) notify = { kind: "telegram", chat_id };
  }

  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535 || !user || !notify) return null;

  return {
    id,
    host,
    port: Math.trunc(port),
    secure,
    user,
    pass,
    mailbox,
    criterion,
    model,
    notify,
    max_body_chars
  };
}

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function readState(statePath: string): Promise<AccountStateV1 | null> {
  try {
    const raw = await fsp.readFile(statePath, "utf-8");
    const j = JSON.parse(raw);
    const lastUid = Number(j?.lastUid);
    if (!Number.isFinite(lastUid) || lastUid < 0) return null;
    return { v: 1, lastUid: Math.trunc(lastUid) };
  } catch {
    return null;
  }
}

async function writeState(statePath: string, st: AccountStateV1): Promise<void> {
  const tmp = `${statePath}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(st, null, 2), "utf-8");
  await fsp.rename(tmp, statePath);
}

async function fetchEmailSummary(client: any, mailbox: string, uid: number, maxTextChars: number): Promise<EmailSummary | null> {
  const raw = await client.download(String(uid), undefined, { uid: true });
  if (!raw?.content) return null;

  const parsed = await simpleParser(raw.content);

  const text = parsed.text ?? "";
  const clipped = text.length > maxTextChars ? text.slice(0, maxTextChars) : text;

  const atts = (parsed.attachments ?? []).slice(0, 10).map((a) => ({
    filename: a.filename || undefined,
    type: a.contentType || undefined,
    size: a.size || undefined
  }));

  return {
    mailbox,
    uid,
    messageId: parsed.messageId || undefined,
    subject: parsed.subject || undefined,
    date: parsed.date ? parsed.date.toISOString() : undefined,
    from: parsed.from?.text ?? "",
    to: typeof parsed.to === "string" ? parsed.to : Array.isArray(parsed.to) ? parsed.to.map((a) => a.text).join(", ") : parsed.to?.text ?? "",
    text: clipped,
    attachments: atts
  };
}

async function evalOneEmail(args: {
  gatewayUrl: string;
  sessionId: string;
  origin: any;
  model?: string;
  template: string;
  criterion: string;
  email: EmailSummary;
  maxBodyChars: number;
}): Promise<{ ok: boolean; outcome: "ignore" | "notified" | "unknown"; text: string }> {
  // Send contextless classification requests (but keep the session transcript for audit).
  const prompt = buildTriagePrompt({ template: args.template, criterion: args.criterion, email: args.email, maxBodyChars: args.maxBodyChars });
  const r = await runGatewayChat({
    gatewayUrl: args.gatewayUrl,
    sessionId: args.sessionId,
    userText: prompt,
    model: args.model,
    toolAccessMode: "full",
    streamMode: "final",
    enabledTools: ["send"],
    includeHistory: false,
    origin: args.origin
  });

  const t = String(r.text ?? "").trim();
  if (t === "IGNORE") return { ok: true, outcome: "ignore", text: t };
  // If the model called `send`, the assistant text might be empty or a short acknowledgement.
  return { ok: true, outcome: t ? "unknown" : "notified", text: t };
}

async function runAccount(rootDir: string, account: EmailListenerAccountConfig, triageTemplate: string): Promise<never> {
  const gatewayUrl = guessGatewayUrl();
  const sessionId = sessionIdForListenerEmail(account.id);
  const origin = originFromNotifyTarget(account.notify);

  // Ensure a stable, non-default session title for audit.
  try {
    await ensureGatewaySession(gatewayUrl, sessionId, sessionTitleForListenerEmail(account.id, account.user), origin);
  } catch (e: any) {
    log.warn(`[${account.id}] failed to ensure gateway session:`, String(e?.message ?? e));
  }

  const stateDir = path.join(rootDir, ".eclia", "listener-email");
  await ensureDir(stateDir);
  const stateKey = account.id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80) || "account";
  const statePath = path.join(stateDir, `${stateKey}.json`);

  let state = await readState(statePath);
  if (!state) state = { v: 1, lastUid: 0 };

  let pending = false;
  let processing: Promise<void> = Promise.resolve();

  const enqueueSync = (reason: string) => {
    pending = true;
    processing = processing
      .then(async () => {
        if (!pending) return;
        pending = false;
        await syncMailbox(reason);
      })
      .catch((e) => {
        log.error(`[${account.id}] sync failed:`, String(e?.message ?? e));
      });
  };

  let currentClient: any = null;

  const syncMailbox = async (reason: string) => {
    const client = currentClient;
    if (!client) return;
    const lock = await client.getMailboxLock(account.mailbox, { readOnly: true });
    let fetched: Array<{ uid: number; email: EmailSummary | null }> = [];
    try {
      // First-run bootstrap: skip existing mail and start from current tip.
      if (state && state.lastUid === 0) {
        const curNext = client.mailbox?.uidNext;
        const guess = typeof curNext === "number" && Number.isFinite(curNext) ? Math.max(0, Math.trunc(curNext) - 1) : 0;
        state.lastUid = guess;
        await writeState(statePath, state);
        log.info(`[${account.id}] bootstrapped lastUid=${state.lastUid} (first run)`);
        return;
      }

      const start = Math.max(1, Math.trunc(state.lastUid + 1));
      const uids = await client.search({ uid: `${start}:*` }, { uid: true });

      if (!Array.isArray(uids) || !uids.length) {
        log.info(`[${account.id}] no new mail (${reason})`);
        return;
      }

      uids.sort((a: any, b: any) => Number(a) - Number(b));
      log.info(`[${account.id}] detected ${uids.length} new uid(s) (${reason}): ${uids[0]}..${uids[uids.length - 1]}`);

      // Fetch summaries under the mailbox lock, but do NOT perform model calls while holding the IMAP lock.
      for (const u of uids) {
        const uid = Number(u);
        if (!Number.isFinite(uid) || uid <= state.lastUid) continue;
        const email = await fetchEmailSummary(client, account.mailbox, uid, account.max_body_chars);
        fetched.push({ uid, email });
      }
    } finally {
      lock.release();
    }

    // Evaluate outside the IMAP lock.
    for (const item of fetched) {
      const uid = item.uid;
      const email = item.email;

      if (!email) {
        state.lastUid = uid;
        await writeState(statePath, state);
        continue;
      }

      const out = await evalOneEmail({
        gatewayUrl,
        sessionId,
        origin,
        model: account.model,
        template: triageTemplate,
        criterion: account.criterion,
        email,
        maxBodyChars: account.max_body_chars
      });

      if (out.ok) {
        if (out.outcome === "ignore") log.info(`[${account.id}] uid=${uid} -> IGNORE`);
        else if (out.outcome === "notified") log.info(`[${account.id}] uid=${uid} -> notified (send tool)`);
      }

      state.lastUid = uid;
      await writeState(statePath, state);
    }
  };

  // Reconnect loop: ImapFlow does not auto-reconnect.
  // See https://imapflow.com/docs/api/imapflow-client/ (Event: 'close').
  for (let attempt = 0; ; attempt++) {
    const backoff = Math.min(30_000, 1_000 * Math.max(1, attempt + 1));
    let client: any = null;
    currentClient = null;
    try {
      client = new ImapFlow({
        host: account.host,
        port: account.port,
        secure: account.secure,
        auth: {
          user: account.user,
          pass: account.pass ?? ""
        },
        logger: false
      });

      client.on("error", (err: any) => {
        log.error(`[${account.id}] imap error:`, String(err?.message ?? err));
      });

      let closedResolve: (() => void) | null = null;
      const closed = new Promise<void>((resolve) => {
        closedResolve = resolve;
      });

      client.on("close", () => {
        log.warn(`[${account.id}] imap connection closed`);
        if (closedResolve) closedResolve();
      });

      await client.connect();
      currentClient = client;

      // Select mailbox under a lock (recommended over mailboxOpen()).
      // With auto-idle enabled (default), ImapFlow enters IDLE when idle.
      const lock = await client.getMailboxLock(account.mailbox, { readOnly: true });
      lock.release();

      log.info(`[${account.id}] IMAP connected. mailbox=${account.mailbox} host=${account.host}:${account.port} secure=${account.secure}`);

      client.on("exists", (data: any) => {
        const count = Number(data?.count);
        const prev = Number(data?.prevCount);
        if (Number.isFinite(count) && Number.isFinite(prev) && count <= prev) return;
        enqueueSync("exists");
      });

      // Startup catch-up (handles missed mail if the process was down).
      enqueueSync("startup");

      // Wait until the server drops us.
      await closed;
    } catch (e: any) {
      log.error(`[${account.id}] connect failed:`, String(e?.message ?? e));
    } finally {
      try {
        if (client) await client.logout().catch(() => null);
      } catch {
        // ignore
      }
      currentClient = null;
    }

    log.warn(`[${account.id}] reconnecting in ${backoff}ms...`);
    await sleep(backoff);
  }
}

async function main() {
  const { rootDir, config } = loadEcliaConfig(process.cwd());
  const pluginCfg = ((config as any)?.plugins?.listener?.email ?? {}) as any;
  const enabled = Boolean(pluginCfg?.enabled ?? false);
  const accountsRaw = Array.isArray(pluginCfg?.accounts) ? ((pluginCfg.accounts as any[]) ?? []) : [];

  if (!enabled) {
    log.warn("listener-email disabled (plugins.listener.email.enabled != true)");
    process.exit(0);
  }

  const accounts: EmailListenerAccountConfig[] = [];
  for (let i = 0; i < accountsRaw.length; i++) {
    const acc = coerceAccount(accountsRaw[i], `account_${i + 1}`);
    if (!acc) {
      log.warn(`skipping invalid account entry at plugins.listener.email.accounts[${i}]`);
      continue;
    }
    accounts.push(acc);
  }

  if (!accounts.length) {
    log.error("listener-email enabled but no valid accounts configured under plugins.listener.email.accounts");
    process.exit(1);
  }

  // Validate destination adapters are enabled.
  for (const a of accounts) {
    if (a.notify.kind === "discord" && !config.adapters.discord.enabled) {
      log.warn(`[${a.id}] notify.kind=discord but adapters.discord.enabled=false (send tool will fail)`);
    }
    if (a.notify.kind === "telegram" && !(config.adapters as any).telegram?.enabled) {
      log.warn(`[${a.id}] notify.kind=telegram but adapters.telegram.enabled=false (send tool will fail)`);
    }
  }

  // Load triage prompt template: _triage.local.md > _triage.md (bootstrap local from default if missing).
  const pluginDir = path.resolve(import.meta.dirname, "..");
  const defaultTemplatePath = path.join(pluginDir, "_triage.md");
  const localTemplatePath = path.join(pluginDir, "_triage.local.md");

  let triageTemplate: string;
  try {
    triageTemplate = await fsp.readFile(localTemplatePath, "utf-8");
  } catch {
    const defaultTemplate = await fsp.readFile(defaultTemplatePath, "utf-8");
    await fsp.writeFile(localTemplatePath, defaultTemplate, "utf-8");
    log.info(`bootstrapped _triage.local.md from _triage.md`);
    triageTemplate = defaultTemplate;
  }

  log.info(`starting listener-email for ${accounts.length} account(s) -> gateway=${guessGatewayUrl()}`);
  await ensureDir(path.join(rootDir, ".eclia", "listener-email"));

  // Fire and forget each account; keep the process alive.
  for (const acc of accounts) {
    runAccount(rootDir, acc, triageTemplate).catch((e) => {
      log.error(`[${acc.id}] fatal:`, String(e?.message ?? e));
    });
  }

  await new Promise(() => {
    // keep alive
  });
}

main().catch((e) => {
  log.error("startup failed:", String(e?.message ?? e));
  process.exit(1);
});
