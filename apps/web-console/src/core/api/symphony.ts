import { apiFetch } from "./apiFetch";

// ─── Types ──────────────────────────────────────────────────

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

export interface ConfigFieldSchema {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "text" | "model";
  required?: boolean;
  default?: unknown;
  sensitive?: boolean;
  placeholder?: string;
  options?: string[];
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

// ─── Instruments ─────────────────────────────────────────────

export async function apiListInstruments(): Promise<InstrumentDetail[]> {
  const r = await apiFetch("/api/symphony/instruments");
  const j = (await r.json()) as OkOrError<{ instruments: InstrumentDetail[] }>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.instruments;
}

export async function apiGetInstrument(id: string): Promise<InstrumentDetail> {
  const r = await apiFetch(`/api/symphony/instruments/${encodeURIComponent(id)}`);
  const j = (await r.json()) as OkOrError<{ instrument: InstrumentDetail }>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.instrument;
}

export async function apiCreateInstrument(payload: Record<string, unknown>): Promise<InstrumentDetail> {
  const r = await apiFetch("/api/symphony/instruments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = (await r.json()) as OkOrError<{ instrument: InstrumentDetail }>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.instrument;
}

export async function apiSetInstrumentEnabled(id: string, enabled: boolean): Promise<void> {
  const r = await apiFetch(`/api/symphony/instruments/${encodeURIComponent(id)}/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
  const j = (await r.json()) as OkOrError<Record<string, never>>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
}

/** Full replacement PUT — same shape as create's structured payload. */
export async function apiUpdateInstrument(
  id: string,
  payload: {
    triggers: Array<{ kind: string; config: Record<string, unknown> }>;
    actions: Array<{ kind: string; config: Record<string, unknown> }>;
  }
): Promise<InstrumentDetail> {
  const r = await apiFetch(`/api/symphony/instruments/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = (await r.json()) as OkOrError<{ instrument: InstrumentDetail }>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.instrument;
}

export async function apiDeleteInstrument(id: string): Promise<void> {
  const r = await apiFetch(`/api/symphony/instruments/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  const j = (await r.json()) as OkOrError<Record<string, never>>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
}

// ─── Presets / Schemas ───────────────────────────────────────

export async function apiListPresets(): Promise<PresetInfo[]> {
  const r = await apiFetch("/api/symphony/presets");
  const j = (await r.json()) as OkOrError<{ presets: PresetInfo[] }>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.presets;
}

export async function apiListTriggers(): Promise<KindSchema[]> {
  const r = await apiFetch("/api/symphony/triggers");
  const j = (await r.json()) as OkOrError<{ triggers: KindSchema[] }>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.triggers;
}

export async function apiListActions(): Promise<KindSchema[]> {
  const r = await apiFetch("/api/symphony/actions");
  const j = (await r.json()) as OkOrError<{ actions: KindSchema[] }>;
  if (!j.ok) throw new Error(j.hint ?? j.error);
  return j.actions;
}
