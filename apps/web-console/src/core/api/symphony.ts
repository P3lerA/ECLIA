import { apiFetch } from "./apiFetch";
import type {
  FlowDef,
  FlowStatus,
  NodeKindSchema,
  ValidationError,
} from "@eclia/symphony-protocol";

// ─── Response shapes ────────────────────────────────────────

type OkOrError<T> = (T & { ok: true }) | { ok: false; error: string; hint?: string };

export type FlowWithStatus = FlowDef & { status: FlowStatus };

/** Fetch + JSON parse + unwrap. Throws on ok:false. */
async function apiJson<T>(input: string, init?: RequestInit): Promise<OkOrError<T> & { ok: true }> {
  const r = await apiFetch(input, init);
  const j = (await r.json()) as OkOrError<T>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j;
}

// ─── Flows ──────────────────────────────────────────────────

export async function apiListFlows(): Promise<FlowWithStatus[]> {
  const j = await apiJson<{ flows: FlowWithStatus[] }>("/api/symphony/flows");
  return j.flows;
}

export async function apiGetFlow(id: string): Promise<FlowWithStatus> {
  const j = await apiJson<{ flow: FlowWithStatus }>(
    `/api/symphony/flows/${encodeURIComponent(id)}`
  );
  return j.flow;
}

export async function apiUpsertFlow(def: FlowDef): Promise<FlowWithStatus> {
  const isNew = !def.id;
  const url = isNew
    ? "/api/symphony/flows"
    : `/api/symphony/flows/${encodeURIComponent(def.id)}`;
  const j = await apiJson<{ flow: FlowWithStatus }>(url, {
    method: isNew ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(def),
  });
  return j.flow;
}

export async function apiDeleteFlow(id: string): Promise<void> {
  await apiJson<Record<string, never>>(
    `/api/symphony/flows/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export async function apiSetFlowEnabled(id: string, enabled: boolean): Promise<void> {
  await apiJson<Record<string, never>>(
    `/api/symphony/flows/${encodeURIComponent(id)}/enabled`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  );
}

// ─── Trigger ────────────────────────────────────────────────

export async function apiTriggerNode(flowId: string, nodeId: string, payload?: unknown): Promise<void> {
  await apiJson<Record<string, never>>(
    `/api/symphony/flows/${encodeURIComponent(flowId)}/trigger/${encodeURIComponent(nodeId)}`,
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

export async function apiValidateFlow(
  def: FlowDef
): Promise<{ valid: boolean; errors: ValidationError[] }> {
  const j = await apiJson<{ valid: boolean; errors: ValidationError[] }>(
    "/api/symphony/flows/validate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(def),
    }
  );
  return { valid: j.valid, errors: j.errors };
}
