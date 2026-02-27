import crypto from "node:crypto";
import path from "node:path";

import { isEcliaRef, uriFromRef, tryParseArtifactUriToRepoRelPath } from "@eclia/tool-protocol";
import type { ChatInputCommandInteraction, Message } from "discord.js";

import type { TranscriptRecord } from "../../gateway.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscordOrigin = {
  kind: "discord";
  guildId?: string;
  guildName?: string;
  channelId: string;
  channelName?: string;
  threadId?: string;
  threadName?: string;
  userId?: string;
  userName?: string;
};

export type SendRequest = {
  origin: DiscordOrigin;
  content?: string;
  refs?: string[];
};

export type DiscordSendFn = (payload: { content: string; files?: any[] }) => Promise<void>;

// ---------------------------------------------------------------------------
// Session ID
// ---------------------------------------------------------------------------

export function sessionIdForDiscord(origin: DiscordOrigin): string {
  const parts: string[] = ["discord"];
  if (origin.guildId) parts.push(`g${origin.guildId}`);
  if (origin.threadId) parts.push(`t${origin.threadId}`);
  else parts.push(`c${origin.channelId}`);
  const id = parts.join("_");
  return id.length <= 120 ? id : id.slice(0, 120);
}

// ---------------------------------------------------------------------------
// Origin extraction
// ---------------------------------------------------------------------------

function extractOriginFields(channel: any, isThread: boolean) {
  const threadName = isThread && typeof channel?.name === "string" ? channel.name : undefined;
  const parentName = isThread && typeof channel?.parent?.name === "string" ? channel.parent.name : undefined;
  const channelName =
    !isThread && typeof channel?.name === "string"
      ? channel.name
      : parentName || (typeof channel?.name === "string" ? channel.name : undefined);
  return { threadName, channelName };
}

export function originFromInteraction(interaction: ChatInputCommandInteraction): DiscordOrigin {
  const guildId = interaction.guildId ?? undefined;
  const guildName = interaction.guild?.name ?? undefined;
  const channelId = interaction.channelId;
  const channel: any = interaction.channel;
  const isThread = Boolean(channel && typeof channel.isThread === "function" && channel.isThread());
  const threadId = isThread ? interaction.channelId : undefined;
  const { threadName, channelName } = extractOriginFields(channel, isThread);
  const userId = interaction.user?.id ?? undefined;
  const userName = interaction.user?.username ?? undefined;

  return { kind: "discord", guildId, guildName, channelId, channelName, threadId, threadName, userId, userName };
}

export function originFromMessage(message: Message): DiscordOrigin {
  const guildId = message.guildId ?? undefined;
  const guildName = message.guild?.name ?? undefined;
  const channelId = message.channelId;
  const channel: any = message.channel;
  const isThread = Boolean(channel && typeof channel.isThread === "function" && channel.isThread());
  const threadId = isThread ? message.channelId : undefined;
  const { threadName, channelName } = extractOriginFields(channel, isThread);
  const userId = message.author?.id ?? undefined;
  const userName = message.author?.username ?? undefined;

  return { kind: "discord", guildId, guildName, channelId, channelName, threadId, threadName, userId, userName };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatToolCallForDiscord(call: any): string {
  const callId = typeof call?.callId === "string" ? call.callId : "";
  const name = typeof call?.name === "string" ? call.name : "";
  const raw = typeof call?.args?.raw === "string" ? call.args.raw : "";
  const approval = call?.args?.approval;
  const needsApproval = Boolean(approval && typeof approval === "object" && (approval as any).required);

  const summaryParts: string[] = [];
  if (name) summaryParts.push(name);
  if (callId) summaryParts.push(`(${callId})`);
  if (needsApproval) summaryParts.push("[needs approval]");
  const summary = summaryParts.join(" ").trim();

  const argLine = raw.trim() ? "\n```json\n" + raw + "\n```" : "";
  return `- ${summary || "tool_call"}${argLine}`;
}

export function formatToolResultForDiscord(name: string, ok: boolean, result: any): string {
  const label = name ? name : "tool";
  const header = `**Tool result:** ${label} (${ok ? "ok" : "error"})`;

  let detail = "";
  const errMsg = typeof result?.error?.message === "string" ? result.error.message : "";
  if (!ok && errMsg) detail = `\n${errMsg}`;

  let body = "";
  try {
    body = JSON.stringify(result ?? null, null, 2);
  } catch {
    body = String(result ?? "");
  }

  return header + detail + "\n```json\n" + body + "\n```";
}

export function formatDiscordOutboundText(raw: string): string {
  const s = String(raw ?? "");
  if (!s) return "";

  const withClosedThinkBlocks = s.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner: string) => {
    const body = String(inner ?? "").trim();
    if (!body) return "> ";
    const quoted = body
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");
    return quoted;
  });
  return withClosedThinkBlocks.replace(/<\/?think>/gi, "");
}

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------

export async function sendTextOrFile(send: DiscordSendFn, text: string): Promise<void> {
  const outgoing = formatDiscordOutboundText(text);
  const t = outgoing.trim() ? outgoing.trim() : "(empty)";
  if (t.length <= 1900) {
    await send({ content: t });
    return;
  }

  const buf = Buffer.from(t, "utf8");
  await send({
    content: "Message too long; attached as a file.",
    files: [{ attachment: buf, name: `eclia-${crypto.randomUUID()}.txt` }]
  });
}

export function canSendToChannel(channel: Message["channel"]): channel is Message["channel"] & { send: (payload: any) => Promise<any> } {
  return typeof (channel as any)?.send === "function";
}

export function createInteractionSendFn(interaction: ChatInputCommandInteraction): DiscordSendFn {
  let first = true;
  return async (payload) => {
    if (first) {
      first = false;
      await interaction.editReply(payload as any);
      return;
    }
    await interaction.followUp(payload as any);
  };
}

export function createMessageSendFn(message: Message): DiscordSendFn {
  let first = true;
  const channelCanSend = canSendToChannel(message.channel);
  return async (payload) => {
    if (first) {
      first = false;
      await message.reply(payload as any);
      return;
    }
    if (channelCanSend) {
      await message.channel.send(payload as any);
      return;
    }
    await message.reply(payload as any);
  };
}

// ---------------------------------------------------------------------------
// Artifact ref resolution
// ---------------------------------------------------------------------------

export function extractRefToRepoRelPath(pointer: string): { relPath: string; name: string } | null {
  const p = String(pointer ?? "").trim();
  if (!p) return null;

  if (isEcliaRef(p)) {
    const uri = uriFromRef(p);
    const rel = tryParseArtifactUriToRepoRelPath(uri);
    if (!rel) return null;
    return { relPath: rel, name: path.basename(rel) || "artifact" };
  }

  if (p.startsWith("eclia://")) {
    const rel = tryParseArtifactUriToRepoRelPath(p);
    if (!rel) return null;
    return { relPath: rel, name: path.basename(rel) || "artifact" };
  }

  if (p.startsWith(".eclia/artifacts/")) {
    return { relPath: p, name: path.basename(p) || "artifact" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared onRecord handler (deduplicates interaction & message callbacks)
// ---------------------------------------------------------------------------

export function makeOnRecordHandler(send: DiscordSendFn) {
  return async (rec: TranscriptRecord): Promise<void> => {
    if (rec.type === "assistant") {
      const parts: string[] = [];
      parts.push("**Assistant**");
      const t = String(rec.text ?? "").trim();
      if (t) parts.push(t);
      if (Array.isArray(rec.toolCalls) && rec.toolCalls.length) {
        parts.push("", "**Tool calls**");
        for (const tc of rec.toolCalls) parts.push(formatToolCallForDiscord(tc));
      }
      await sendTextOrFile(send, parts.join("\n"));
      return;
    }

    if (rec.type === "tool_result") {
      const msg = formatToolResultForDiscord(rec.name, Boolean(rec.ok), rec.result);
      await sendTextOrFile(send, msg);
      return;
    }
  };
}
