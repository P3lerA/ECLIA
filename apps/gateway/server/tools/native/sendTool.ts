import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import {
  artifactRefFromRepoRelPath,
  isEcliaRef,
  normalizeRepoRelPath,
  tryParseArtifactUriToRepoRelPath,
  uriFromRef
} from "@eclia/tool-protocol";

import type { ToolAccessMode } from "../policy.js";
import type { ToolSafetyCheck } from "../approvalFlow.js";

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

function normalizeStringList(input: unknown): string[] {
  const out: string[] = [];
  for (const s of toStringArray(input)) {
    const t = String(s ?? "").trim();
    if (t) out.push(t);
  }
  return out;
}

export type SendDestination =
  | { kind: "origin" }
  | { kind: "web" }
  | { kind: "discord" }
  | { kind: "telegram" };

export type NormalizedSendToolArgs = {
  destination?: SendDestination;
  destinationProvided: boolean;

  content: string;

  /** Artifact pointers: <eclia://artifact/...> or eclia://artifact/... or .eclia/artifacts/... */
  refs: string[];

  /** Local file paths (must be absolute; safe mode requires approval). */
  paths: string[];
};

export const SEND_TOOL_SCHEMA: any = {
  type: "object",
  additionalProperties: true,
  properties: {
    destination: {
      description:
        "Where to send the message. Default is {kind:'origin'} (the request source). For {kind:'discord'} / {kind:'telegram'}, the channel/chat is always derived from the session/request origin (not model-specified).",
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["origin", "web", "discord", "telegram"] }
          },
          required: ["kind"]
        },
        { type: "string", enum: ["origin", "web", "discord", "telegram"] }
      ]
    },
    content: { type: "string", description: "Text/markdown content to send." },
    text: { type: "string", description: "Alias of content." },

    // Artifact refs.
    refs: {
      type: "array",
      items: { type: "string" },
      description: "Artifact refs/URIs/paths. Example: <eclia://artifact/.eclia/artifacts/...>"
    },

    // Local files.
    paths: { type: "array", items: { type: "string" }, description: "Absolute file paths on the local machine." }
  }
};

export function parseSendArgs(raw: unknown): NormalizedSendToolArgs {
  const obj = isRecord(raw) ? raw : {};

  const destinationProvided = Object.prototype.hasOwnProperty.call(obj, "destination");
  const destination = normalizeDestination((obj as any).destination);

  const content =
    typeof (obj as any).content === "string"
      ? String((obj as any).content)
      : typeof (obj as any).text === "string"
        ? String((obj as any).text)
        : typeof (obj as any).message === "string"
          ? String((obj as any).message)
          : "";

  const refs: string[] = [];
  for (const r of normalizeStringList((obj as any).refs)) refs.push(r);

  const paths: string[] = [];
  for (const p of normalizeStringList((obj as any).paths)) paths.push(p);

  return {
    destination,
    destinationProvided,
    content,
    refs,
    paths
  };
}

function normalizeDestination(input: unknown): SendDestination | undefined {
  if (!input) return undefined;

  if (typeof input === "string") {
    const k = input.trim();
    if (k === "origin" || k === "web") return { kind: k };
    if (k === "discord" || k === "dc") return { kind: "discord" };
    if (k === "telegram" || k === "tg") return { kind: "telegram" };
    return undefined;
  }

  if (!isRecord(input)) return undefined;
  const kind = typeof input.kind === "string" ? input.kind.trim() : "";

  if (kind === "origin" || kind === "web") return { kind };
  if (kind === "discord" || kind === "dc") return { kind: "discord" };
  if (kind === "telegram" || kind === "tg") return { kind: "telegram" };

  return undefined;
}

export function isAbsoluteAny(p: string): boolean {
  const s = String(p ?? "").trim();
  if (!s) return false;
  // Native check for current OS.
  if (path.isAbsolute(s)) return true;
  // Windows drive letter (even when running on POSIX).
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  // UNC paths.
  if (s.startsWith("\\\\")) return true;
  return false;
}

export function checkSendNeedsApproval(args: NormalizedSendToolArgs, toolAccessMode: ToolAccessMode): ToolSafetyCheck {
  if (toolAccessMode !== "safe") return { requireApproval: false, reason: "mode_full" };

  const manualDestination = Boolean(args.destinationProvided && args.destination && args.destination.kind !== "origin");
  const hasLocalFiles = Array.isArray(args.paths) && args.paths.some((p) => isAbsoluteAny(p));

  if (manualDestination && hasLocalFiles) {
    return { requireApproval: true, reason: "safe_manual_destination_and_local_files" };
  }
  if (manualDestination) {
    return { requireApproval: true, reason: "safe_manual_destination" };
  }
  if (hasLocalFiles) {
    return { requireApproval: true, reason: "safe_local_files" };
  }

  // Safe mode: sending artifacts to the origin is allowed without approval.
  return { requireApproval: false, reason: "safe_artifacts_only" };
}

export type ResolvedArtifactPointer = {
  pointer: string;
  relPath: string;
  name: string;
};

export function tryResolveArtifactPointer(pointer: string): ResolvedArtifactPointer | null {
  const p0 = typeof pointer === "string" ? pointer.trim() : "";
  if (!p0) return null;

  // Accept: <eclia://artifact/...>
  let rel: string | null = null;
  if (isEcliaRef(p0)) {
    const uri = uriFromRef(p0);
    rel = tryParseArtifactUriToRepoRelPath(uri);
  } else if (p0.startsWith("eclia://")) {
    rel = tryParseArtifactUriToRepoRelPath(p0);
  } else {
    rel = normalizeRepoRelPath(p0);
  }

  if (!rel) return null;
  const relNorm = normalizeRepoRelPath(rel);

  // Restrict to artifacts only.
  if (!relNorm.startsWith(".eclia/artifacts/")) return null;

  return { pointer: p0, relPath: relNorm, name: path.basename(relNorm) };
}

function guessMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".txt":
    case ".log":
    case ".md":
      return "text/plain; charset=utf-8";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function kindFromMime(mime: string, filePath: string): "image" | "json" | "text" | "file" {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.includes("json") || filePath.toLowerCase().endsWith(".json")) return "json";
  if (m.startsWith("text/")) return "text";
  return "file";
}

async function sha256FileMaybe(absPath: string, maxBytes: number): Promise<string | null> {
  try {
    const st = await fsp.stat(absPath);
    if (!st.isFile()) return null;
    if (st.size > maxBytes) return null;
    const buf = await fsp.readFile(absPath);
    const h = crypto.createHash("sha256");
    h.update(buf);
    return h.digest("hex");
  } catch {
    return null;
  }
}

function safePathSegment(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "_";
  // Keep it readable and prevent traversal.
  const cleaned = t.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return cleaned.length ? cleaned.slice(0, 120) : "_";
}

function safeFileName(name: string): string {
  const base = path.basename(String(name ?? "")).trim();
  if (!base) return "file";
  // Remove path separators and other odd chars.
  const cleaned = base.replace(/[\\/]+/g, "_").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned.length ? cleaned.slice(0, 160) : "file";
}

function uniqueDestPath(dirAbs: string, desiredName: string): string {
  const base = safeFileName(desiredName);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;

  let candidate = path.join(dirAbs, base);
  if (!fs.existsSync(candidate)) return candidate;

  for (let i = 0; i < 10; i++) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const nextName = `${stem}-${suffix}${ext}`;
    candidate = path.join(dirAbs, nextName);
    if (!fs.existsSync(candidate)) return candidate;
  }

  // Fallback.
  return path.join(dirAbs, `${stem}-${Date.now()}${ext}`);
}

export type PreparedSendAttachments = {
  refs: string[]; // normalized angle refs
  artifacts: any[]; // artifact metadata (same shape as exec_result.artifacts)
  copiedFromPaths: Array<{ source: string; ref: string; path: string }>;
};

export async function prepareSendAttachments(args: {
  rootDir: string;
  sessionId: string;
  callId: string;
  refs: string[];
  paths: string[];
}): Promise<{ ok: true; value: PreparedSendAttachments } | { ok: false; error: { code: string; message: string } }> {
  const rootDir = args.rootDir;
  const outRefs: string[] = [];
  const artifacts: any[] = [];
  const copiedFromPaths: Array<{ source: string; ref: string; path: string }> = [];

  // 1) Existing artifact refs.
  for (const pointer of args.refs ?? []) {
    const resolved = tryResolveArtifactPointer(pointer);
    if (!resolved) {
      return {
        ok: false,
        error: { code: "bad_artifact_ref", message: `Invalid artifact pointer: ${String(pointer)}` }
      };
    }

    const abs = path.resolve(rootDir, resolved.relPath);
    // Extra guard: ensure under <root>/.eclia/artifacts.
    const artifactsRoot = path.resolve(rootDir, ".eclia", "artifacts");
    if (abs !== artifactsRoot && !abs.startsWith(artifactsRoot + path.sep)) {
      return {
        ok: false,
        error: { code: "forbidden_artifact_ref", message: `Artifact is outside allowed root: ${resolved.relPath}` }
      };
    }

    let st: fs.Stats;
    try {
      st = await fsp.stat(abs);
    } catch {
      return { ok: false, error: { code: "artifact_not_found", message: `Artifact not found: ${resolved.relPath}` } };
    }

    if (!st.isFile()) {
      return { ok: false, error: { code: "artifact_not_found", message: `Artifact is not a file: ${resolved.relPath}` } };
    }

    const mime = guessMimeFromPath(abs);
    const { uri, ref } = artifactRefFromRepoRelPath(resolved.relPath);
    artifacts.push({
      kind: kindFromMime(mime, abs),
      path: resolved.relPath,
      uri,
      ref,
      role: "artifact",
      bytes: st.size,
      mime,
      sha256: await sha256FileMaybe(abs, 5_000_000)
    });
    outRefs.push(ref);

    if (outRefs.length >= 32) break;
  }

  // 2) Local file paths -> copy into artifacts and reference via <eclia://artifact/...>.
  const localPaths = Array.isArray(args.paths) ? args.paths : [];
  if (localPaths.length) {
    const dirAbs = path.join(rootDir, ".eclia", "artifacts", safePathSegment(args.sessionId), safePathSegment(args.callId));
    try {
      await fsp.mkdir(dirAbs, { recursive: true });
    } catch {
      return { ok: false, error: { code: "artifact_dir_failed", message: "Failed to create artifact directory" } };
    }

    for (const p of localPaths) {
      const absSrc = String(p ?? "").trim();
      if (!absSrc) continue;
      if (!isAbsoluteAny(absSrc)) {
        return { ok: false, error: { code: "invalid_file_path", message: `File path must be absolute: ${absSrc}` } };
      }

      let st: fs.Stats;
      try {
        st = await fsp.stat(absSrc);
      } catch {
        return { ok: false, error: { code: "file_not_found", message: `File not found: ${absSrc}` } };
      }

      if (!st.isFile()) {
        return { ok: false, error: { code: "file_not_found", message: `Not a file: ${absSrc}` } };
      }

      const destAbs = uniqueDestPath(dirAbs, path.basename(absSrc));
      try {
        await fsp.copyFile(absSrc, destAbs);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        return { ok: false, error: { code: "file_copy_failed", message: `Failed to copy file: ${msg}` } };
      }

      const rel = normalizeRepoRelPath(path.relative(rootDir, destAbs));
      const mime = guessMimeFromPath(destAbs);
      const { uri, ref } = artifactRefFromRepoRelPath(rel);

      artifacts.push({
        kind: kindFromMime(mime, destAbs),
        path: rel,
        uri,
        ref,
        role: "artifact",
        bytes: st.size,
        mime,
        sha256: await sha256FileMaybe(destAbs, 5_000_000)
      });
      outRefs.push(ref);
      copiedFromPaths.push({ source: absSrc, ref, path: rel });

      // Do not allow unlimited attachments.
      if (outRefs.length >= 32) break;
    }
  }

  return { ok: true, value: { refs: outRefs, artifacts, copiedFromPaths } };
}
