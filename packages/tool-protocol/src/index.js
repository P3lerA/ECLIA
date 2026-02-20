/**
 * Shared tool protocol utilities for ECLIA.
 *
 * Design goals:
 * - Keep tool input parsing and tool-output reference conventions consistent across:
 *   - gateway
 *   - toolhosts
 *   - future tools (read/send/...)
 *
 * Reference convention:
 * - Any resource that can be referenced later MUST include an "angle ref":
 *      ref: "<eclia://artifact/...>"
 *   The angle brackets are intentional: models can copy/paste them verbatim.
 */

export const ECLIA_TOOL_RESULT_KIND = "eclia.tool_result";
export const ECLIA_TOOL_RESULT_VERSION = 1;

export const ECLIA_URI_SCHEME = "eclia";
export const ECLIA_ARTIFACT_URI_HOST = "artifact";

function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampInt(v, fallback, min, max) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeEnv(extra) {
  if (!isRecord(extra)) return {};
  const out = {};
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Best-effort exec args normalization.
 *
 * The exec tool intentionally accepts a single entry point: `command`.
 *
 * IMPORTANT: this is intentionally permissive about types (numbers, etc.) so the
 * model can succeed even when it sends slightly-wrong shapes.
 */
export function parseExecArgs(raw) {
  const obj = isRecord(raw) ? raw : {};
  return {
    command: typeof obj.command === "string" && obj.command.trim() ? obj.command.trim() : undefined,
    cwd: typeof obj.cwd === "string" && obj.cwd.trim() ? obj.cwd.trim() : undefined,
    timeoutMs: clampInt(obj.timeoutMs, 60_000, 1_000, 60 * 60_000),
    maxStdoutBytes: clampInt(obj.maxStdoutBytes, 200_000, 1_000, 20_000_000),
    maxStderrBytes: clampInt(obj.maxStderrBytes, 200_000, 1_000, 20_000_000),
    env: normalizeEnv(obj.env)
  };
}

// --- ECLIA resource/URI helpers --------------------------------------------

export function normalizeRepoRelPath(p) {
  let s = String(p ?? "");
  // Prefer forward slashes.
  s = s.replace(/\\/g, "/");
  // Strip leading ./
  while (s.startsWith("./")) s = s.slice(2);
  // Collapse duplicate separators.
  s = s.replace(/\/+/g, "/");
  return s;
}

export function encodePathForUri(relPath) {
  const norm = normalizeRepoRelPath(relPath);
  const parts = norm.split("/").filter((p) => p.length > 0);
  return parts.map((p) => encodeURIComponent(p)).join("/");
}

export function artifactUriFromRepoRelPath(relPath) {
  const enc = encodePathForUri(relPath);
  return `${ECLIA_URI_SCHEME}://${ECLIA_ARTIFACT_URI_HOST}/${enc}`;
}

export function refFromUri(uri) {
  const s = String(uri ?? "").trim();
  return s ? `<${s}>` : "";
}

export function artifactRefFromRepoRelPath(relPath) {
  const uri = artifactUriFromRepoRelPath(relPath);
  return { uri, ref: refFromUri(uri) };
}

export function isEcliaRef(s) {
  if (typeof s !== "string") return false;
  return /^<eclia:\/\/[^>]+>$/.test(s.trim());
}

export function uriFromRef(s) {
  if (!isEcliaRef(s)) return "";
  const t = String(s).trim();
  return t.slice(1, -1);
}

export function tryParseArtifactUriToRepoRelPath(uri) {
  const u = String(uri ?? "").trim();
  const prefix = `${ECLIA_URI_SCHEME}://${ECLIA_ARTIFACT_URI_HOST}/`;
  if (!u.startsWith(prefix)) return null;
  const enc = u.slice(prefix.length);
  if (!enc) return null;
  try {
    const parts = enc.split("/").map((p) => decodeURIComponent(p));
    return normalizeRepoRelPath(parts.join("/"));
  } catch {
    return null;
  }
}

export function makeToolResultEnvelope(input) {
  const tool = String(input?.tool ?? "").trim() || "tool";
  const ok = Boolean(input?.ok);
  const summary = typeof input?.summary === "string" ? input.summary : "";

  const out = {
    kind: ECLIA_TOOL_RESULT_KIND,
    v: ECLIA_TOOL_RESULT_VERSION,
    tool,
    ok,
    summary
  };

  if (typeof input?.data !== "undefined") out.data = input.data;
  if (Array.isArray(input?.resources) && input.resources.length) out.resources = input.resources;
  if (input?.error && typeof input.error === "object") out.error = input.error;
  if (input?.meta && typeof input.meta === "object") out.meta = input.meta;

  return out;
}
