import http from "node:http";
import crypto from "node:crypto";

import type TelegramBot from "node-telegram-bot-api";
import { loadEcliaConfig } from "@eclia/config";

import {
  boolEnv,
  env,
  hasEnv,
  json,
  makeAdapterLogger,
  normalizeIdList,
  readJson
} from "../../utils.js";
import {
  fetchArtifactBytes,
  getGatewayToken,
  guessGatewayUrl,
  resetGatewaySession,
  runGatewayChat
} from "../../gateway.js";

import {
  extractRefToRepoRelPath,
  originFromMessage,
  sessionIdForTelegram,
  type SendRequest
} from "./telegram-format.js";

const log = makeAdapterLogger("telegram");

function parseToolAccessMode(raw: string): "safe" | "full" {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "safe" ? "safe" : "full";
}

function idsFromEnv(): string[] {
  const list =
    env("ECLIA_TELEGRAM_USER_WHITELIST") ||
    env("TELEGRAM_USER_WHITELIST") ||
    env("ECLIA_TELEGRAM_USER_IDS") ||
    env("TELEGRAM_USER_IDS") ||
    env("ECLIA_TELEGRAM_USER_ID") ||
    env("TELEGRAM_USER_ID");

  return list ? normalizeIdList(list) : [];
}

function groupIdsFromEnv(): string[] {
  const list =
    env("ECLIA_TELEGRAM_GROUP_WHITELIST") ||
    env("TELEGRAM_GROUP_WHITELIST") ||
    env("ECLIA_TELEGRAM_GROUP_IDS") ||
    env("TELEGRAM_GROUP_IDS") ||
    env("ECLIA_TELEGRAM_GROUP_ID") ||
    env("TELEGRAM_GROUP_ID");

  return list ? normalizeIdList(list) : [];
}

function isCommand(text: string, cmd: string, botUsername?: string): boolean {
  const t = String(text ?? "").trim();
  if (!t.startsWith("/")) return false;
  const head = t.split(/\s+/, 1)[0] ?? "";
  if (!head) return false;
  const name = head.slice(1);
  if (!name) return false;
  const [base, at] = name.split("@", 2);
  if (base !== cmd) return false;
  if (!at) return true;
  const want = String(botUsername ?? "").replace(/^@/, "").trim();
  return want ? at === want : true;
}

function commandArgs(text: string): string {
  const t = String(text ?? "").trim();
  if (!t.startsWith("/")) return "";
  return t.replace(/^\/\S+/, "").trim();
}

async function sendTextOrFile(bot: TelegramBot, chatId: string, text: string, opts?: any): Promise<void> {
  const t = String(text ?? "").trim() || "(empty)";
  // Telegram hard limit is 4096 chars for sendMessage; leave some headroom.
  if (t.length <= 3900) {
    await bot.sendMessage(chatId, t, opts);
    return;
  }

  const buf = Buffer.from(t, "utf8");
  await bot.sendDocument(
    chatId,
    buf,
    { caption: "Message too long; attached as a file.", ...(opts ?? {}) },
    { filename: `eclia-${crypto.randomUUID()}.txt` }
  );
}

async function registerBotCommands(bot: TelegramBot, groupChatIds: string[]): Promise<void> {
  // Telegram clients can show a command list when the user types `/` and via the menu button.
  // Scopes let us avoid advertising /eclia in non-whitelisted groups.
  // See: https://core.telegram.org/bots/api#setmycommands

  // Keep the global/default menu minimal to avoid confusion in non-whitelisted groups.
  const defaultCommands = [{ command: "start", description: "Show help" }];
  const privateCommands = [
    { command: "start", description: "Show help" },
    { command: "clear", description: "Reset this chat session" },
    { command: "eclia", description: "Ask ECLIA (optional)" }
  ];
  const groupCommands = [
    { command: "start", description: "Show help" },
    { command: "clear", description: "Reset this chat session" },
    { command: "eclia", description: "Ask ECLIA: /eclia <prompt>" }
  ];

  try {
    // Defensive cleanup: if a previous version set all-group commands, non-whitelisted groups would
    // still show them. Wipe those out and rely on per-chat scopes.
    await (bot as any).deleteMyCommands({ scope: { type: "all_group_chats" } }).catch(() => null);
  } catch {
    // ignore
  }

  // Default scope.
  await (bot as any).setMyCommands(defaultCommands, { scope: { type: "default" } }).catch(() => null);

  // All private chats.
  await (bot as any).setMyCommands(privateCommands, { scope: { type: "all_private_chats" } }).catch(() => null);

  // Only whitelisted group chats (scope=chat).
  for (const chatId of groupChatIds) {
    if (!chatId) continue;
    await (bot as any).setMyCommands(groupCommands, { scope: { type: "chat", chat_id: chatId } }).catch(() => null);
  }
}

async function main() {
  // Silence node-telegram-bot-api sending-files deprecation warnings by opting into the new behavior.
  // See: https://github.com/yagop/node-telegram-bot-api/blob/master/doc/usage.md#file-options-metadata
  if (!process.env.NTBA_FIX_350) process.env.NTBA_FIX_350 = "1";

  const { default: TelegramBot } = await import("node-telegram-bot-api");

  const { config } = loadEcliaConfig(process.cwd());
  const tgCfg: any = (config.adapters as any)?.telegram ?? {};

  const enabled = hasEnv("ECLIA_TELEGRAM_ENABLED") ? boolEnv("ECLIA_TELEGRAM_ENABLED") : Boolean(tgCfg.enabled);
  if (!enabled) {
    log.info("disabled (enable via adapters.telegram.enabled)");
    return;
  }

  const token = env("ECLIA_TELEGRAM_BOT_TOKEN") || env("TELEGRAM_BOT_TOKEN") || String(tgCfg.bot_token ?? "").trim();
  if (!token) {
    throw new Error("Missing Telegram bot token (set adapters.telegram.bot_token in eclia.config.local.toml or TELEGRAM_BOT_TOKEN env)");
  }

  const wlEnv = idsFromEnv();
  const wlCfg = Array.isArray(tgCfg.user_whitelist) ? tgCfg.user_whitelist : [];
  const userWhitelist = wlEnv.length ? wlEnv : normalizeIdList(wlCfg);
  const userWhitelistSet = new Set(userWhitelist);

  const gwlEnv = groupIdsFromEnv();
  const gwlCfg = Array.isArray(tgCfg.group_whitelist) ? tgCfg.group_whitelist : [];
  const groupWhitelist = gwlEnv.length ? gwlEnv : normalizeIdList(gwlCfg);
  const groupWhitelistSet = new Set(groupWhitelist);

  if (userWhitelistSet.size === 0) {
    log.warn("WARNING: user_whitelist is empty; the bot will reply to nobody.");
  }

  const gatewayUrl = guessGatewayUrl();
  const gatewayToken = getGatewayToken();
  if (!gatewayToken) {
    log.warn("WARNING: missing ECLIA_GATEWAY_TOKEN; gateway may reject requests.");
  }

  const toolAccessMode = parseToolAccessMode(env("ECLIA_TELEGRAM_TOOL_ACCESS_MODE", "full"));

  const bot = new TelegramBot(token, { polling: true });
  const me = await bot.getMe().catch(() => null);
  const botUsername = me && typeof (me as any).username === "string" ? String((me as any).username).trim() : "";

  log.info(`started (bot=${botUsername || "unknown"}, users=${userWhitelistSet.size}, groups=${groupWhitelistSet.size})`);

  await registerBotCommands(bot, [...groupWhitelistSet]).catch((e) => {
    log.warn("failed to register bot commands", e);
  });

  // Serialize requests per chat (prevents interleaved replies when the user sends multiple messages quickly).
  const queueByChat = new Map<string, Promise<void>>();
  const enqueue = (chatId: string, fn: () => Promise<void>) => {
    const prev = queueByChat.get(chatId) ?? Promise.resolve();
    const next = prev
      .catch(() => {
        // swallow prior errors so the queue doesn't break
      })
      .then(fn)
      .finally(() => {
        if (queueByChat.get(chatId) === next) queueByChat.delete(chatId);
      });
    queueByChat.set(chatId, next);
  };

  type PendingPrompt = { replyToMessageId?: number; createdAt: number };
  const pendingPromptByChatUser = new Map<string, PendingPrompt>();
  const pendingKey = (chatId: string, userId: string) => `${chatId}:${userId}`;
  const pendingTtlMs = 2 * 60 * 1000;

  bot.on("message", (msg: any) => {
    const chatType = typeof msg?.chat?.type === "string" ? msg.chat.type : "";
    const isPrivate = chatType === "private";
    const isGroup = chatType === "group" || chatType === "supergroup";
    if (!isPrivate && !isGroup) return;

    const chatId = msg?.chat && (typeof msg.chat.id === "number" || typeof msg.chat.id === "string") ? String(msg.chat.id).trim() : "";
    if (!chatId) return;

    if (isGroup && !groupWhitelistSet.has(chatId)) return;

    const userId = msg?.from && (typeof msg.from.id === "number" || typeof msg.from.id === "string") ? String(msg.from.id).trim() : "";
    const fromIsBot = Boolean(msg?.from?.is_bot);
    if (fromIsBot) return;
    if (!userId || !userWhitelistSet.has(userId)) return;

    const pkey = pendingKey(chatId, userId);

    const text = typeof msg?.text === "string" ? msg.text.trim() : "";
    if (!text) return;

    enqueue(chatId, async () => {
      const origin = originFromMessage(msg);
      const sessionId = sessionIdForTelegram(origin);

      const replyOpts = isGroup && typeof msg?.message_id === "number" ? { reply_to_message_id: msg.message_id, allow_sending_without_reply: true } : undefined;

      try {
        if (isCommand(text, "clear", botUsername)) {
          pendingPromptByChatUser.delete(pkey);
          await resetGatewaySession(gatewayUrl, sessionId);
          await bot.sendMessage(chatId, isGroup ? "Cleared session for this group." : "Cleared session for this chat.", replyOpts);
          return;
        }

        if (isCommand(text, "start", botUsername)) {
          pendingPromptByChatUser.delete(pkey);
          await bot.sendMessage(
            chatId,
            "ECLIA Telegram adapter is running.\n\n- Private chat: send any message.\n- Group chat: use /eclia <prompt>.\n- Use /clear to reset this session.",
            replyOpts
          );
          return;
        }

        if (isCommand(text, "eclia", botUsername)) {
          const prompt = commandArgs(text);
          if (!prompt) {
            // This plays nicer with the command menu: selecting /eclia often sends the command
            // immediately, without arguments.
            const sent = await bot
              .sendMessage(
                chatId,
                isGroup ? "Reply to this message with your prompt:" : "Send your prompt:",
                {
                  ...(replyOpts ?? {}),
                  reply_markup: {
                    force_reply: true,
                    selective: true,
                    input_field_placeholder: "Type your prompt..."
                  }
                }
              )
              .catch(() => null);

            pendingPromptByChatUser.set(pkey, {
              replyToMessageId: sent && typeof (sent as any).message_id === "number" ? (sent as any).message_id : undefined,
              createdAt: Date.now()
            });
            return;
          }

          await bot.sendChatAction(chatId, "typing").catch(() => null);

          const out = await runGatewayChat({
            gatewayUrl,
            sessionId,
            origin,
            streamMode: "final",
            userText: prompt,
            toolAccessMode
          });

          await sendTextOrFile(bot, chatId, out.text || "(empty)", replyOpts);
          return;
        }

        // If the user previously invoked /eclia without a prompt, treat the next reply as the prompt.
        const pending = pendingPromptByChatUser.get(pkey);
        if (pending) {
          const now = Date.now();
          if (now - pending.createdAt > pendingTtlMs) {
            pendingPromptByChatUser.delete(pkey);
          } else if (!text.startsWith("/")) {
            const replyTo = msg?.reply_to_message && typeof msg.reply_to_message.message_id === "number" ? msg.reply_to_message.message_id : undefined;
            const ok = isPrivate || (typeof replyTo === "number" && typeof pending.replyToMessageId === "number" && replyTo === pending.replyToMessageId);
            if (ok) {
              pendingPromptByChatUser.delete(pkey);
              await bot.sendChatAction(chatId, "typing").catch(() => null);

              const out = await runGatewayChat({
                gatewayUrl,
                sessionId,
                origin,
                streamMode: "final",
                userText: text,
                toolAccessMode
              });

              await sendTextOrFile(bot, chatId, out.text || "(empty)", replyOpts);
              return;
            }
          }
        }

        // In group chats we only respond to explicit /eclia invocations.
        if (isGroup) return;

        if (text.startsWith("/")) {
          await bot.sendMessage(chatId, "Unknown command. Available: /clear", replyOpts);
          return;
        }

        // Best-effort UX: show typing while waiting.
        await bot.sendChatAction(chatId, "typing").catch(() => null);

        const out = await runGatewayChat({
          gatewayUrl,
          sessionId,
          origin,
          streamMode: "final",
          userText: text,
          toolAccessMode
        });

        await sendTextOrFile(bot, chatId, out.text || "(empty)", replyOpts);
      } catch (e: any) {
        const msgText = String(e?.message ?? e);
        log.error("handler error", e);
        await bot.sendMessage(chatId, `Error: ${msgText}`, replyOpts).catch(() => null);
      }
    });
  });

  // ----- Outbound HTTP endpoint (gateway -> adapter -> telegram) -----

  const port = Number(env("ECLIA_TELEGRAM_ADAPTER_PORT", "8791")) || 8791;
  const key = env("ECLIA_ADAPTER_KEY");

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    if (u.pathname === "/health") return json(res, 200, { ok: true });

    if (u.pathname === "/send" && req.method === "POST") {
      if (key) {
        const got = String(req.headers["x-eclia-adapter-key"] ?? "");
        if (got !== key) return json(res, 403, { ok: false, error: "forbidden" });
      }

      const body = (await readJson(req)) as SendRequest;
      const origin = body?.origin as any;
      if (!origin || origin.kind !== "telegram" || typeof origin.chatId !== "string") {
        return json(res, 400, { ok: false, error: "bad_origin" });
      }

      const chatId = String(origin.chatId).trim();
      if (!chatId) return json(res, 400, { ok: false, error: "bad_origin" });

      const refs = Array.isArray(body.refs) ? body.refs : [];
      const files: Array<{ name: string; buf: Buffer }> = [];
      for (const r of refs) {
        const parsed = extractRefToRepoRelPath(r);
        if (!parsed) continue;
        const buf = await fetchArtifactBytes(gatewayUrl, parsed.relPath);
        files.push({ name: parsed.name, buf });
        if (files.length >= 10) break;
      }

      const contentStr = typeof body.content === "string" ? body.content : "";
      if (contentStr.trim().length) {
        await sendTextOrFile(bot, chatId, contentStr);
      } else if (!files.length) {
        await bot.sendMessage(chatId, "(empty)");
      }

      for (const f of files) {
        await bot.sendDocument(chatId, f.buf, {}, { filename: f.name || "artifact" });
      }

      return json(res, 200, { ok: true });
    }

    return json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, "127.0.0.1", () => {
    log.info(`outbound endpoint: http://127.0.0.1:${port}`);
  });
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
