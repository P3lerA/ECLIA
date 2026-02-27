import type { SessionMetaV1 } from "../../sessionTypes.js";

function trimString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function shortenTitle(s: string): string {
  return s.length > 96 ? s.slice(0, 96).trimEnd() + "…" : s;
}

export function deriveDiscordTitle(origin: SessionMetaV1["origin"] | undefined): string | null {
  if (!origin || typeof origin !== "object") return null;
  const kind = trimString((origin as any).kind);
  if (kind !== "discord") return null;

  const guildName = trimString((origin as any).guildName);
  const channelName = trimString((origin as any).channelName);
  const threadName = trimString((origin as any).threadName);
  const userName = trimString((origin as any).userName);

  const guildId = trimString((origin as any).guildId);
  const channelId = trimString((origin as any).channelId);
  const threadId = trimString((origin as any).threadId);
  const userId = trimString((origin as any).userId);

  const parts: string[] = ["Discord"];

  // DM sessions have no guild context; label with user when available.
  const isDm = !guildName && !guildId;
  if (isDm) {
    parts.push("DM");
    if (userName) parts.push(userName);
    else if (userId) parts.push(`u${userId}`);
    else if (channelName) parts.push(channelName);
    else if (channelId) parts.push(`c${channelId}`);
  } else {
    if (guildName) parts.push(guildName);
    else if (guildId) parts.push(`g${guildId}`);

    if (channelName) parts.push(`#${channelName}`);
    else if (channelId) parts.push(`c${channelId}`);

    if (threadName) parts.push(threadName);
    else if (threadId) parts.push(`t${threadId}`);
  }

  const s = parts.filter(Boolean).join(" · ").trim();
  if (!s) return null;
  return shortenTitle(s);
}
