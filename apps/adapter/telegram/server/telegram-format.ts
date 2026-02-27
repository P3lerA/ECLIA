import path from "node:path";

import { isEcliaRef, uriFromRef, tryParseArtifactUriToRepoRelPath } from "@eclia/tool-protocol";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TelegramOrigin = {
  kind: "telegram";

  chatId: string;
  chatType?: string;
  chatTitle?: string;

  /** Telegram "forum topic" thread id (future). */
  threadId?: string;
  threadName?: string;

  userId?: string;
  userName?: string;
};

export type SendRequest = {
  origin: TelegramOrigin;
  content?: string;
  refs?: string[];
};

// ---------------------------------------------------------------------------
// Session ID
// ---------------------------------------------------------------------------

export function sessionIdForTelegram(origin: TelegramOrigin): string {
  const parts: string[] = ["telegram"];
  parts.push(`c${origin.chatId}`);
  if (origin.threadId) parts.push(`t${origin.threadId}`);
  const id = parts.join("_");
  return id.length <= 120 ? id : id.slice(0, 120);
}

// ---------------------------------------------------------------------------
// Origin extraction
// ---------------------------------------------------------------------------

function formatUserName(from: any): string | undefined {
  if (!from || typeof from !== "object") return undefined;
  const username = typeof from.username === "string" ? from.username.trim() : "";
  if (username) return username;
  const first = typeof from.first_name === "string" ? from.first_name.trim() : "";
  const last = typeof from.last_name === "string" ? from.last_name.trim() : "";
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || undefined;
}

export function originFromMessage(message: any): TelegramOrigin {
  const chat = message?.chat;
  const from = message?.from;

  const chatId = chat && (typeof chat.id === "number" || typeof chat.id === "string") ? String(chat.id).trim() : "";
  const chatType = typeof chat?.type === "string" ? chat.type.trim() : undefined;
  const chatTitle = typeof chat?.title === "string" ? chat.title.trim() : undefined;

  const threadId = typeof message?.message_thread_id === "number" ? String(message.message_thread_id) : undefined;

  const userId = from && (typeof from.id === "number" || typeof from.id === "string") ? String(from.id).trim() : undefined;
  const userName = formatUserName(from);

  return {
    kind: "telegram",
    chatId,
    chatType,
    chatTitle,
    threadId,
    userId,
    userName
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
