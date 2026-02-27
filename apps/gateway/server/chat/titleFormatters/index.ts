import type { SessionMetaV1 } from "../../sessionTypes.js";

import { deriveDiscordTitle } from "./discord.js";
import { deriveTelegramTitle } from "./telegram.js";

type OriginTitleFormatter = {
  deriveTitle: (origin: SessionMetaV1["origin"] | undefined) => string | null;
};

const FORMATTERS: Record<string, OriginTitleFormatter> = {
  discord: {
    deriveTitle: deriveDiscordTitle
  },
  telegram: {
    deriveTitle: deriveTelegramTitle
  }
};

function pickFormatter(origin: SessionMetaV1["origin"] | undefined): OriginTitleFormatter | null {
  if (!origin || typeof origin !== "object") return null;
  const kind = typeof (origin as any).kind === "string" ? (origin as any).kind.trim() : "";
  if (!kind) return null;
  return FORMATTERS[kind] ?? null;
}

export function deriveTitleFromOriginByKind(origin: SessionMetaV1["origin"] | undefined): string | null {
  const f = pickFormatter(origin);
  if (!f) return null;
  return f.deriveTitle(origin);
}
