import { apiFetch } from "./apiFetch";
import type {
  OpusDef,
  OpusStatus,
  NodeKindSchema,
  ValidationError,
} from "@eclia/symphony-protocol";

// ─── Response shapes ────────────────────────────────────────

type OkOrError<T> = (T & { ok: true }) | { ok: false; error: string; hint?: string; errors?: ValidationError[] };

export type OpusWithStatus = OpusDef & { status: OpusStatus };

export class SymphonyValidationError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(`Validation failed (${errors.length} error${errors.length > 1 ? "s" : ""})`);
    this.errors = errors;
  }
}

/** Fetch + JSON parse + unwrap. Throws on ok:false. */
async function apiJson<T>(input: string, init?: RequestInit): Promise<OkOrError<T> & { ok: true }> {
  const r = await apiFetch(input, init);
  const j = (await r.json()) as OkOrError<T>;
  if (!j.ok) {
    if (j.error === "validation_failed" && j.errors?.length) {
      throw new SymphonyValidationError(j.errors);
    }
    throw new Error(j.hint ?? j.error);
  }
  return j;
}

// ─── Opus ──────────────────────────────────────────────────

export async function apiListOpus(): Promise<OpusWithStatus[]> {
  const j = await apiJson<{ opus: OpusWithStatus[] }>("/api/symphony/opus");
  return j.opus;
}

export async function apiGetOpus(id: string): Promise<OpusWithStatus> {
  const j = await apiJson<{ opus: OpusWithStatus }>(
    `/api/symphony/opus/${encodeURIComponent(id)}`
  );
  return j.opus;
}

export async function apiUpsertOpus(def: OpusDef): Promise<OpusWithStatus> {
  const j = await apiJson<{ opus: OpusWithStatus }>(
    `/api/symphony/opus/${encodeURIComponent(def.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(def),
    }
  );
  return j.opus;
}

export async function apiDeleteOpus(id: string): Promise<void> {
  await apiJson<Record<string, never>>(
    `/api/symphony/opus/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export async function apiSetOpusEnabled(id: string, enabled: boolean): Promise<OpusWithStatus> {
  const j = await apiJson<{ opus: OpusWithStatus }>(
    `/api/symphony/opus/${encodeURIComponent(id)}/enabled`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  );
  return j.opus;
}

export async function apiReloadOpus(id: string): Promise<OpusWithStatus> {
  const j = await apiJson<{ opus: OpusWithStatus }>(
    `/api/symphony/opus/${encodeURIComponent(id)}/reload`,
    { method: "POST" }
  );
  return j.opus;
}

// ─── Trigger ────────────────────────────────────────────────

export async function apiTriggerNode(opusId: string, nodeId: string, payload?: unknown): Promise<void> {
  await apiJson<Record<string, never>>(
    `/api/symphony/opus/${encodeURIComponent(opusId)}/trigger/${encodeURIComponent(nodeId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    }
  );
}

// ─── Node kinds ─────────────────────────────────────────────

export async function apiListNodeKinds(): Promise<NodeKindSchema[]> {
  const j = await apiJson<{ nodes: NodeKindSchema[] }>("/api/symphony/nodes");
  return j.nodes;
}

// ─── Validation ─────────────────────────────────────────────

export async function apiValidateOpus(
  def: OpusDef
): Promise<{ valid: boolean; errors: ValidationError[] }> {
  const j = await apiJson<{ valid: boolean; errors: ValidationError[] }>(
    "/api/symphony/opus/validate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(def),
    }
  );
  return { valid: j.valid, errors: j.errors };
}
