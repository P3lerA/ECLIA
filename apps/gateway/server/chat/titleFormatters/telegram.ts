import type { SessionMetaV1 } from "../../sessionTypes.js";

function trimString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function shortenTitle(s: string): string {
  return s.length > 96 ? s.slice(0, 96).trimEnd() + "…" : s;
}

export function deriveTelegramTitle(origin: SessionMetaV1["origin"] | undefined): string | null {
  if (!origin || typeof origin !== "object") return null;
  const kind = trimString((origin as any).kind);
  if (kind !== "telegram") return null;

  const chatType = trimString((origin as any).chatType);
  const chatTitle = trimString((origin as any).chatTitle);
  const userName = trimString((origin as any).userName);

  const chatId = trimString((origin as any).chatId);
  const userId = trimString((origin as any).userId);
  const threadId = trimString((origin as any).threadId);
  const threadName = trimString((origin as any).threadName);

  const parts: string[] = ["Telegram"];

  const isPrivate = chatType === "private" || (!chatTitle && !threadId && !threadName);
  if (isPrivate) {
    parts.push("DM");
    if (userName) parts.push(userName);
    else if (userId) parts.push(`u${userId}`);
    else if (chatId) parts.push(`c${chatId}`);
  } else {
    if (chatTitle) parts.push(chatTitle);
    else if (chatId) parts.push(`c${chatId}`);

    if (threadName) parts.push(threadName);
    else if (threadId) parts.push(`t${threadId}`);
  }

  const s = parts.filter(Boolean).join(" · ").trim();
  if (!s) return null;
  return shortenTitle(s);
}
