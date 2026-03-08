import { apiFetch } from "./apiFetch";
import type { ConfigFieldSchema } from "@eclia/config";

// ─── Types ──────────────────────────────────────────────────

export type { ConfigFieldSchema };

export interface InstrumentDetail {
  id: string;
  name: string;
  enabled: boolean;
  status: "stopped" | "starting" | "running" | "error";
  triggers: Array<{
    kind: string;
    config: Record<string, unknown>;
  }>;
  actions: Array<{
    kind: string;
    config: Record<string, unknown>;
  }>;
}

export interface KindSchema {
  kind: string;
  label: string;
  configSchema: ConfigFieldSchema[];
}

export interface PresetInfo {
  presetId: string;
  name: string;
  description: string;
  triggerKinds: string[];
  actionKinds: string[];
  configSchema: ConfigFieldSchema[];
}

type OkOrError<T> = (T & { ok: true }) | { ok: false; error: string; hint?: string };

/** Fetch + JSON parse + OkOrError unwrap in one step. */
async function apiJson<T>(input: string, init?: RequestInit): Promise<OkOrError<T> & { ok: true }> {
  const r = await apiFetch(input, init);
  const j = (await r.json()) as OkOrError<T>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j;
}

// ─── Instruments ─────────────────────────────────────────────

export async function apiListInstruments(): Promise<InstrumentDetail[]> {
  const j = await apiJson<{ instruments: InstrumentDetail[] }>("/api/symphony/instruments");
  return j.instruments;
}

export async function apiCreateInstrument(payload: Record<string, unknown>): Promise<InstrumentDetail> {
  const j = await apiJson<{ instrument: InstrumentDetail }>("/api/symphony/instruments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return j.instrument;
}

export async function apiSetInstrumentEnabled(id: string, enabled: boolean): Promise<void> {
  await apiJson<Record<string, never>>(`/api/symphony/instruments/${encodeURIComponent(id)}/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
}

/** Full replacement PUT — same shape as create's structured payload. */
export async function apiUpdateInstrument(
  id: string,
  payload: {
    triggers: Array<{ kind: string; config: Record<string, unknown> }>;
    actions: Array<{ kind: string; config: Record<string, unknown> }>;
  }
): Promise<InstrumentDetail> {
  const j = await apiJson<{ instrument: InstrumentDetail }>(`/api/symphony/instruments/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return j.instrument;
}

export async function apiDeleteInstrument(id: string): Promise<void> {
  await apiJson<Record<string, never>>(`/api/symphony/instruments/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

// ─── Presets / Schemas ───────────────────────────────────────

export async function apiListPresets(): Promise<PresetInfo[]> {
  const j = await apiJson<{ presets: PresetInfo[] }>("/api/symphony/presets");
  return j.presets;
}

export async function apiListTriggers(): Promise<KindSchema[]> {
  const j = await apiJson<{ triggers: KindSchema[] }>("/api/symphony/triggers");
  return j.triggers;
}

export async function apiListActions(): Promise<KindSchema[]> {
  const j = await apiJson<{ actions: KindSchema[] }>("/api/symphony/actions");
  return j.actions;
}
