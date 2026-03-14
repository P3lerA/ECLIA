import path from "node:path";

import { isEcliaRef, uriFromRef, tryParseArtifactUriToRepoRelPath } from "@eclia/tool-protocol";

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
// Tool access mode
// ---------------------------------------------------------------------------

export function parseToolAccessMode(raw: string): "safe" | "full" {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "safe" ? "safe" : "full";
}

// ---------------------------------------------------------------------------
// Process error handlers
// ---------------------------------------------------------------------------

export function installProcessErrorHandlers(name: string): void {
  process.on("uncaughtException", (err) => { console.error(`[${name}] uncaughtException:`, err); });
  process.on("unhandledRejection", (err) => { console.error(`[${name}] unhandledRejection:`, err); });
}
