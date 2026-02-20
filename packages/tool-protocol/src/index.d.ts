export const ECLIA_TOOL_RESULT_KIND: "eclia.tool_result";
export const ECLIA_TOOL_RESULT_VERSION: 1;

export const ECLIA_URI_SCHEME: "eclia";
export const ECLIA_ARTIFACT_URI_HOST: "artifact";

export type ExecToolArgs = {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  env?: Record<string, string>;
};

export type NormalizedExecToolArgs = {
  command?: string;
  cwd?: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  env: Record<string, string>;
};

export type EcliaToolError = {
  code: string;
  message: string;
  details?: unknown;
};

export type LegacyArtifact = {
  kind: "image" | "text" | "json" | "file";
  path: string;
  bytes?: number;
  mime?: string;
  sha256?: string;
  [k: string]: unknown;
};

export type EcliaResource = LegacyArtifact & {
  uri: string;
  ref: string;
  role?: "stdout" | "stderr" | "artifact" | string;
  name?: string;
};

export type ToolResultEnvelopeV1<TData = unknown> = {
  kind: typeof ECLIA_TOOL_RESULT_KIND;
  v: typeof ECLIA_TOOL_RESULT_VERSION;
  tool: string;
  ok: boolean;
  summary: string;
  data?: TData;
  resources?: EcliaResource[];
  error?: EcliaToolError;
  meta?: Record<string, unknown>;
};

export function parseExecArgs(raw: unknown): NormalizedExecToolArgs;

export function normalizeRepoRelPath(p: string): string;
export function encodePathForUri(relPath: string): string;
export function artifactUriFromRepoRelPath(relPath: string): string;
export function refFromUri(uri: string): string;
export function artifactRefFromRepoRelPath(relPath: string): { uri: string; ref: string };

export function isEcliaRef(s: unknown): boolean;
export function uriFromRef(s: unknown): string;
export function tryParseArtifactUriToRepoRelPath(uri: string): string | null;

export function makeToolResultEnvelope<TData = unknown>(input: {
  tool: string;
  ok: boolean;
  summary: string;
  data?: TData;
  resources?: EcliaResource[];
  error?: EcliaToolError;
  meta?: Record<string, unknown>;
}): ToolResultEnvelopeV1<TData>;
