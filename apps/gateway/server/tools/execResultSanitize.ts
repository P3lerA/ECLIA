import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { artifactRefFromRepoRelPath } from "@eclia/tool-protocol";

const MAX_INLINE_TEXT_BYTES = 24_000;
const PREVIEW_TEXT_BYTES = 12_000;
const MAX_SHA256_BYTES = 5_000_000;

type ArtifactRef = {
  kind: "image" | "text" | "json" | "file";
  path: string; // repo-relative path
  uri?: string;
  ref?: string;
  role?: string;
  bytes: number;
  mime?: string;
  sha256?: string;
};

function normalizeRelPath(p: string): string {
  // Ensure a stable path format across platforms (use forward slashes).
  return p.split(path.sep).join("/");
}

function safeFileToken(s: string): string {
  const cleaned = String(s ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  // Keep filenames reasonably short (some platforms have low limits).
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

function sha256Hex(data: Buffer | string, encoding?: BufferEncoding): string {
  const h = crypto.createHash("sha256");
  if (typeof data === "string") h.update(data, encoding ?? "utf8");
  else h.update(data);
  return h.digest("hex");
}

async function writeArtifact(args: {
  rootDir: string;
  artifactsRoot: string;
  relFile: string;
  data: Buffer | string;
  encoding?: BufferEncoding;
}): Promise<{ absPath: string; relPath: string; bytes: number; sha256?: string }> {
  const absPath = path.join(args.artifactsRoot, args.relFile);
  try {
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
  } catch {
    // ignore
  }

  if (typeof args.data === "string") await fsp.writeFile(absPath, args.data, args.encoding ?? "utf8");
  else await fsp.writeFile(absPath, args.data);

  const bytes =
    typeof args.data === "string" ? Buffer.byteLength(args.data, args.encoding ?? "utf8") : args.data.length;

  // Hashing huge strings/buffers is expensive and (for our purposes) not always worth it.
  const sha256 = bytes <= MAX_SHA256_BYTES ? sha256Hex(args.data, args.encoding) : undefined;

  const relPath = normalizeRelPath(path.relative(args.rootDir, absPath));
  return { absPath, relPath, bytes, sha256 };
}

function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) return s;
  return buf.subarray(0, maxBytes).toString("utf8");
}

async function externalizeLargeTextField(args: {
  rootDir: string;
  artifactsRoot: string;
  sessionId: string;
  callId: string;
  output: any;
  field: "stdout" | "stderr";
  artifacts: ArtifactRef[];
}) {
  const v = args.output?.[args.field];
  if (typeof v !== "string" || !v) return;

  const bytes = Buffer.byteLength(v, "utf8");
  if (bytes <= MAX_INLINE_TEXT_BYTES) return;

  const relFile = path.join(args.sessionId, `${safeFileToken(args.callId)}_${args.field}.txt`);
  const w = await writeArtifact({
    rootDir: args.rootDir,
    artifactsRoot: args.artifactsRoot,
    relFile,
    data: v,
    encoding: "utf8"
  });

  const { uri, ref } = artifactRefFromRepoRelPath(w.relPath);

  args.artifacts.push({
    kind: "text",
    path: w.relPath,
    uri,
    ref,
    role: args.field,
    bytes: w.bytes,
    mime: "text/plain",
    sha256: w.sha256
  });

  const preview = truncateUtf8(v, PREVIEW_TEXT_BYTES);
  args.output[args.field] = `${preview}\n...[truncated, full ${args.field} saved to ${w.relPath}]`;

  // Keep the toolhost's own truncation flags as-is; we add a separate marker.
  args.output.redacted = { ...(args.output.redacted ?? {}), [args.field]: true };
}

/**
 * Prevent huge tool payloads (e.g. massive stdout) from freezing the UI or blowing up model context.
 *
 * Currently this focuses on exec results:
 * - If stdout/stderr exceed MAX_INLINE_TEXT_BYTES, we write them to .eclia/artifacts/<session>/<callId>_stdout.txt etc.
 * - We keep a small preview inline and attach artifact refs.
 */
export async function sanitizeExecResultForUiAndModel(args: {
  rootDir: string;
  sessionId: string;
  callId: string;
  output: any;
}): Promise<any> {
  const out = args.output;
  if (!out || typeof out !== "object" || out.type !== "exec_result") return out;

  const artifactsRoot = path.join(args.rootDir, ".eclia", "artifacts");
  try {
    await fsp.mkdir(artifactsRoot, { recursive: true });
  } catch {
    // ignore
  }

  const artifacts: ArtifactRef[] = Array.isArray((out as any).artifacts) ? (out as any).artifacts : [];

  // Generic safety: large stdout/stderr gets externalized to artifacts.
  await externalizeLargeTextField({
    rootDir: args.rootDir,
    artifactsRoot,
    sessionId: args.sessionId,
    callId: args.callId,
    output: out,
    field: "stdout",
    artifacts
  });

  await externalizeLargeTextField({
    rootDir: args.rootDir,
    artifactsRoot,
    sessionId: args.sessionId,
    callId: args.callId,
    output: out,
    field: "stderr",
    artifacts
  });

  if (artifacts.length) (out as any).artifacts = artifacts;

  return out;
}
