import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";

import { loadEcliaConfig } from "@eclia/config";
import { isEcliaRef, uriFromRef, tryParseArtifactUriToRepoRelPath } from "@eclia/tool-protocol";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type Message
} from "discord.js";

type DiscordOrigin = {
  kind: "discord";
  guildId?: string;
  channelId: string;
  threadId?: string;
};

type SendRequest = {
  origin: DiscordOrigin;
  content?: string;
  refs?: string[]; // <eclia://artifact/...> or eclia://artifact/... or .eclia/artifacts/...
};

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  return (v ?? fallback ?? "").trim();
}

function hasEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function boolEnv(name: string): boolean {
  const v = env(name).toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function json(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sessionIdForDiscord(origin: DiscordOrigin): string {
  // SessionStore requires: /^[a-zA-Z0-9_-]{1,120}$/
  // Discord snowflakes are numeric, so we can safely embed them.
  const parts: string[] = ["discord"];
  if (origin.guildId) parts.push(`g${origin.guildId}`);
  // If threadId exists, it is already a channel id in Discord.
  if (origin.threadId) parts.push(`t${origin.threadId}`);
  else parts.push(`c${origin.channelId}`);
  const id = parts.join("_");
  return id.length <= 120 ? id : id.slice(0, 120);
}

function guessGatewayUrl(): string {
  const explicit = env("ECLIA_GATEWAY_URL");
  if (explicit) return explicit;
  const { config } = loadEcliaConfig(process.cwd());
  return `http://127.0.0.1:${config.api.port}`;
}

async function ensureGatewaySession(gatewayUrl: string, sessionId: string, origin: DiscordOrigin) {
  const r = await fetch(`${gatewayUrl}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: sessionId,
      title: `Discord ${origin.threadId ? "thread" : "channel"} ${origin.threadId ?? origin.channelId}`,
      origin
    })
  });
  const j = (await r.json().catch(() => null)) as any;
  if (!j?.ok) throw new Error(`failed_to_create_session: ${j?.error ?? r.status}`);
  return j.session;
}

type SseEvent = { event: string; data: string };

async function* iterSse(resp: Response): AsyncGenerator<SseEvent> {
  if (!resp.body) return;
  const decoder = new TextDecoder();
  let buf = "";

  // Node's fetch body is an AsyncIterable<Uint8Array>
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

function now() {
  return Date.now();
}

function truncateForDiscord(s: string, max: number = 1900): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 20) + "\n…(truncated)";
}

async function runGatewayChat(args: {
  gatewayUrl: string;
  sessionId: string;
  userText: string;
  model?: string;
  toolAccessMode?: "safe" | "full";
  streamToDiscord?: (partial: string) => Promise<void>;
}): Promise<{ text: string; meta?: any }>
{
  const resp = await fetch(`${args.gatewayUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: args.sessionId,
      userText: args.userText,
      model: args.model,
      toolAccessMode: args.toolAccessMode ?? "safe"
    })
  });

  let current = "";
  let lastCompleted = "";
  let meta: any = undefined;
  let lastEditAt = 0;

  for await (const ev of iterSse(resp)) {
    if (ev.event === "meta") {
      try { meta = JSON.parse(ev.data); } catch { /* ignore */ }
    }
    if (ev.event === "assistant_start") {
      current = "";
    }
    if (ev.event === "delta") {
      try {
        const j = JSON.parse(ev.data) as any;
        const text = typeof j?.text === "string" ? j.text : "";
        if (text) current += text;

        if (args.streamToDiscord) {
          const t = now();
          // Very conservative edit throttle (Discord rate limits are easy to hit).
          if (t - lastEditAt > 1200 && current.trim()) {
            lastEditAt = t;
            await args.streamToDiscord(truncateForDiscord(current));
          }
        }
      } catch {
        // ignore malformed chunks
      }
    }
    if (ev.event === "assistant_end") {
      lastCompleted = current;
    }
    if (ev.event === "error") {
      try {
        const j = JSON.parse(ev.data) as any;
        throw new Error(String(j?.message ?? "gateway_error"));
      } catch (e: any) {
        throw new Error(String(e?.message ?? e));
      }
    }
    if (ev.event === "done") break;
  }

  const text = (lastCompleted || current).trim();
  return { text, meta };
}

async function registerSlashCommands(args: { token: string; appId: string; guildId?: string }) {
  const rest = new REST({ version: "10" }).setToken(args.token);

  const commands = [
    {
      name: "eclia",
      description: "Chat with ECLIA",
      options: [
        {
          name: "prompt",
          description: "What should ECLIA do?",
          type: 3,
          required: true
        }
      ]
    }
  ];

  if (args.guildId) {
    await rest.put(Routes.applicationGuildCommands(args.appId, args.guildId), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(args.appId), { body: commands });
  }
}

function originFromInteraction(interaction: ChatInputCommandInteraction): DiscordOrigin {
  const guildId = interaction.guildId ?? undefined;
  const channelId = interaction.channelId;
  // Threads are channels too, but we store a separate key for clarity.
  const threadId = (interaction.channel && (interaction.channel as any).isThread?.()) ? interaction.channelId : undefined;
  return { kind: "discord", guildId, channelId, threadId };
}

function originFromMessage(message: Message): DiscordOrigin {
  const guildId = message.guildId ?? undefined;
  const channelId = message.channelId;
  const threadId = (message.channel as any).isThread?.() ? message.channelId : undefined;
  return { kind: "discord", guildId, channelId, threadId };
}

function extractRefToRepoRelPath(pointer: string): { relPath: string; name: string } | null {
  const p = String(pointer ?? "").trim();
  if (!p) return null;

  // 1) <eclia://artifact/...>
  if (isEcliaRef(p)) {
    const uri = uriFromRef(p);
    const rel = tryParseArtifactUriToRepoRelPath(uri);
    if (!rel) return null;
    return { relPath: rel, name: path.basename(rel) || "artifact" };
  }

  // 2) eclia://artifact/...
  if (p.startsWith("eclia://")) {
    const rel = tryParseArtifactUriToRepoRelPath(p);
    if (!rel) return null;
    return { relPath: rel, name: path.basename(rel) || "artifact" };
  }

  // 3) direct repo-relative artifact path
  if (p.startsWith(".eclia/artifacts/")) {
    const rel = p;
    return { relPath: rel, name: path.basename(rel) || "artifact" };
  }

  return null;
}

async function fetchArtifactBytes(gatewayUrl: string, relPath: string): Promise<Buffer> {
  const u = new URL(`${gatewayUrl}/api/artifacts`);
  u.searchParams.set("path", relPath);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`artifact_fetch_failed (${r.status})`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

async function main() {
  const { config } = loadEcliaConfig(process.cwd());
  const discordCfg = config.adapters.discord;

  const enabled = hasEnv("ECLIA_DISCORD_ENABLED") ? boolEnv("ECLIA_DISCORD_ENABLED") : Boolean(discordCfg.enabled);
  if (!enabled) {
    console.log("[adapter-discord] disabled (set adapters.discord.enabled=true in eclia.config.local.toml)");
    process.exit(0);
  }

  const token = env("DISCORD_BOT_TOKEN") || String(discordCfg.bot_token ?? "").trim();
  const appId = env("DISCORD_APP_ID") || String(discordCfg.app_id ?? "").trim();
  const guildId = env("DISCORD_GUILD_ID") || undefined;

  if (!token) {
    console.error("[adapter-discord] Missing Discord bot token. Set it in Settings -> Adapters -> Discord (local TOML), or DISCORD_BOT_TOKEN.");
    process.exit(1);
  }
  if (!appId) {
    console.error(
      "[adapter-discord] Missing Discord Application ID (DISCORD_APP_ID / adapters.discord.app_id). " +
        "It is required to register slash commands. Set it in Settings -> Adapters -> Discord, or DISCORD_APP_ID env."
    );
    process.exit(1);
  }

  const gatewayUrl = guessGatewayUrl();
  const streamEdits = boolEnv("ECLIA_DISCORD_STREAM");
  const allowPrefix = boolEnv("ECLIA_DISCORD_ALLOW_MESSAGE_PREFIX");
  const prefix = env("ECLIA_DISCORD_PREFIX", "!eclia");
  const toolAccessMode = (env("ECLIA_DISCORD_TOOL_ACCESS_MODE", "safe") as any) === "full" ? "full" : "safe";

  console.log(`[adapter-discord] gateway: ${gatewayUrl}`);

  console.log("[adapter-discord] Registering slash commands...");
  await registerSlashCommands({ token, appId, guildId });
  console.log(`[adapter-discord] Slash commands registered ${guildId ? "(guild)" : "(global)"}`);

  const intents = [GatewayIntentBits.Guilds];
  if (allowPrefix) {
    // Prefix-based chat requires message content intent.
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }

  const client = new Client({
    intents,
    partials: [Partials.Channel]
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[adapter-discord] Logged in as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "eclia") return;

    const prompt = interaction.options.getString("prompt", true);
    const origin = originFromInteraction(interaction);
    const sessionId = sessionIdForDiscord(origin);

    try {
      await interaction.deferReply();

      await ensureGatewaySession(gatewayUrl, sessionId, origin);

      const streamFn = streamEdits
        ? async (partial: string) => {
            try {
              await interaction.editReply(partial || "…");
            } catch {
              // ignore edit errors
            }
          }
        : undefined;

      const out = await runGatewayChat({
        gatewayUrl,
        sessionId,
        userText: prompt,
        toolAccessMode,
        streamToDiscord: streamFn
      });

      const text = out.text || "(empty)";
      if (text.length <= 1900) {
        await interaction.editReply(text);
      } else {
        const buf = Buffer.from(text, "utf8");
        await interaction.editReply({
          content: "Response too long; attached as a file.",
          files: [{ attachment: buf, name: `eclia-${crypto.randomUUID()}.txt` }]
        });
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      try {
        await interaction.editReply(`Error: ${msg}`);
      } catch {
        // ignore
      }
    }
  });

  if (allowPrefix) {
    client.on(Events.MessageCreate, async (message) => {
      if (!message.content) return;
      if (message.author?.bot) return;
      const content = message.content.trim();
      if (!content.startsWith(prefix)) return;

      const prompt = content.slice(prefix.length).trim();
      if (!prompt) return;

      const origin = originFromMessage(message);
      const sessionId = sessionIdForDiscord(origin);

      try {
        const reply = await message.reply("…");
        await ensureGatewaySession(gatewayUrl, sessionId, origin);

        const streamFn = streamEdits
          ? async (partial: string) => {
              try {
                await reply.edit(partial || "…");
              } catch {
                // ignore
              }
            }
          : undefined;

        const out = await runGatewayChat({
          gatewayUrl,
          sessionId,
          userText: prompt,
          toolAccessMode,
          streamToDiscord: streamFn
        });

        const text = out.text || "(empty)";
        if (text.length <= 1900) {
          await reply.edit(text);
        } else {
          const buf = Buffer.from(text, "utf8");
          await reply.edit({ content: "Response too long; attached as a file." });
          await message.channel.send({ files: [{ attachment: buf, name: `eclia-${crypto.randomUUID()}.txt` }] });
        }
      } catch (e: any) {
        await message.reply(`Error: ${String(e?.message ?? e)}`);
      }
    });
  }

  // Outbound endpoint for `send` tool (future): gateway -> adapter -> discord
  const port = Number(env("ECLIA_DISCORD_ADAPTER_PORT", "8790")) || 8790;
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
      const origin = body?.origin;
      if (!origin || origin.kind !== "discord" || typeof origin.channelId !== "string") {
        return json(res, 400, { ok: false, error: "bad_origin" });
      }

      const targetId = origin.threadId ?? origin.channelId;
      const channel = await client.channels.fetch(targetId).catch(() => null);
      if (!channel || !(channel as any).isTextBased?.()) {
        return json(res, 404, { ok: false, error: "channel_not_found" });
      }

      const refs = Array.isArray(body.refs) ? body.refs : [];
      const files: Array<{ attachment: Buffer; name: string }> = [];
      for (const r of refs) {
        const parsed = extractRefToRepoRelPath(r);
        if (!parsed) continue;
        const buf = await fetchArtifactBytes(gatewayUrl, parsed.relPath);
        files.push({ attachment: buf, name: parsed.name });
        // Do not send too many files in one request.
        if (files.length >= 10) break;
      }

      const content = typeof body.content === "string" ? body.content : "";

      await (channel as any).send({
        content: content || (files.length ? "" : "(empty)"),
        files: files.length ? files : undefined
      });

      return json(res, 200, { ok: true });
    }

    return json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[adapter-discord] outbound endpoint: http://127.0.0.1:${port}`);
  });

  await client.login(token);
}

main().catch((e) => {
  console.error("[adapter-discord] fatal", e);
  process.exit(1);
});
