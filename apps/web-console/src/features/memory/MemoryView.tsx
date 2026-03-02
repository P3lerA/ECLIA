import React from "react";

import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { EcliaLogo } from "../common/EcliaLogo";

import { fetchDevConfig, saveDevConfig } from "../settings/settingsInteractions";
import type { ConfigRequestBody, ConfigResponse } from "../settings/settingsTypes";
import { isValidPort, portNumber } from "../settings/settingsUtils";
import { SettingsAdvancedSection } from "../settings/components/SettingsAdvancedSection";
import { SettingsToggleRow } from "../settings/components/SettingsToggleRow";
import { apiFetch } from "../../core/api/apiFetch";

// ---------------------------------------------------------------------------
// Curated embedding models grouped by language
// ---------------------------------------------------------------------------

type EmbeddingLanguage = "en" | "zh" | "multi";

type CuratedModel = {
  value: string;
  label: string;
};

const EMBEDDING_MODELS: Record<EmbeddingLanguage, CuratedModel[]> = {
  en: [
    { value: "all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2 — fast, lightweight" },
    { value: "all-mpnet-base-v2", label: "all-mpnet-base-v2 — higher quality" },
    { value: "multi-qa-MiniLM-L6-cos-v1", label: "multi-qa-MiniLM-L6-cos-v1 — QA optimised" },
  ],
  zh: [
    { value: "shibing624/text2vec-base-chinese", label: "text2vec-base-chinese — Chinese tuned" },
    { value: "DMetaSoul/sbert-chinese-general-v2", label: "sbert-chinese-general-v2 — general Chinese" },
    { value: "paraphrase-multilingual-MiniLM-L12-v2", label: "multilingual-MiniLM-L12-v2 — 50+ languages" },
  ],
  multi: [
    { value: "paraphrase-multilingual-MiniLM-L12-v2", label: "multilingual-MiniLM-L12-v2 — 50+ languages" },
    { value: "distiluse-base-multilingual-cased-v2", label: "distiluse-multilingual-v2 — 15 languages, light" },
    { value: "paraphrase-multilingual-mpnet-base-v2", label: "multilingual-mpnet-base-v2 — higher quality" },
  ],
};

const LANGUAGE_OPTIONS: { value: EmbeddingLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
  { value: "multi", label: "Multi-Language" },
];

/** Infer language category from a model name. */
function inferLanguage(model: string): EmbeddingLanguage {
  for (const lang of ["zh", "multi", "en"] as EmbeddingLanguage[]) {
    if (EMBEDDING_MODELS[lang].some((m) => m.value === model)) return lang;
  }
  // Default: if the model name hints at Chinese/multilingual, pick accordingly.
  const lower = model.toLowerCase();
  if (lower.includes("chinese") || lower.includes("text2vec")) return "zh";
  if (lower.includes("multilingual") || lower.includes("multi-")) return "multi";
  return "en";
}

// ---------------------------------------------------------------------------
// Memory service API helpers (via gateway proxy /api/memory/*)
// ---------------------------------------------------------------------------

type ModelStatus = "unknown" | "checking" | "cached" | "not_cached" | "downloading" | "deleting" | "error";

async function memoryApiFetch(path: string, init?: RequestInit): Promise<any | null> {
  try {
    const resp = await apiFetch(`/api/memory${path}`, {
      ...init,
      signal: AbortSignal.timeout(init?.method === "POST" ? 630_000 : 8_000)
    });
    return await resp.json();
  } catch {
    return null;
  }
}

async function checkModelCached(model: string): Promise<boolean | null> {
  const data = await memoryApiFetch(`/embeddings/status?model=${encodeURIComponent(model)}`);
  if (!data || data.ok !== true) return null;
  return Boolean(data.cached);
}

async function downloadModel(model: string): Promise<{ ok: boolean; error?: string }> {
  const data = await memoryApiFetch("/embeddings/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model })
  });
  if (!data) return { ok: false, error: "Memory service unreachable" };
  return { ok: Boolean(data.ok), error: data.error };
}

async function deleteModel(model: string): Promise<{ ok: boolean; error?: string }> {
  const data = await memoryApiFetch("/embeddings/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model })
  });
  if (!data) return { ok: false, error: "Memory service unreachable" };
  return { ok: Boolean(data.ok), error: data.error };
}

type MemoryBase = {
  enabled: boolean;
  host: string;
  port: number;
  recentTurns: number;
  recallLimit: number;
  timeoutMs: number;
  embeddingsModel: string;
};

type MemoryDraft = {
  enabled: boolean;
  host: string;
  port: string;
  recentTurns: string;
  recallLimit: string;
  timeoutMs: string;
  embeddingsModel: string;
};

function asStr(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function intOrNull(s: string, min: number, max: number): number | null {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < min || i > max) return null;
  return i;
}

function readMemoryBase(cfg: any): MemoryBase {
  const mem = (cfg as any)?.memory ?? {};

  const enabled = Boolean(mem?.enabled ?? false);
  const host = asStr(mem?.host).trim() || "127.0.0.1";

  const portRaw = Number(asStr(mem?.port));
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 8788;

  const recentTurnsRaw = Number(asStr(mem?.recent_turns));
  const recentTurns = Number.isFinite(recentTurnsRaw) ? Math.trunc(recentTurnsRaw) : 8;

  const recallLimitRaw = Number(asStr(mem?.recall_limit));
  const recallLimit = Number.isFinite(recallLimitRaw) ? Math.trunc(recallLimitRaw) : 20;

  const timeoutRaw = Number(asStr(mem?.timeout_ms));
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.trunc(timeoutRaw) : 1200;

  const embModel = asStr(mem?.embeddings?.model).trim() || "all-MiniLM-L6-v2";

  return {
    enabled,
    host,
    port,
    recentTurns,
    recallLimit,
    timeoutMs,
    embeddingsModel: embModel
  };
}


function baseToDraft(base: MemoryBase): MemoryDraft {
  return {
    enabled: base.enabled,
    host: base.host,
    port: String(base.port),
    recentTurns: String(base.recentTurns),
    recallLimit: String(base.recallLimit),
    timeoutMs: String(base.timeoutMs),
    embeddingsModel: String(base.embeddingsModel ?? "").trim() || "all-MiniLM-L6-v2"
  };
}

export function MemoryView({ onBack }: { onBack: () => void }) {
  const [cfgLoading, setCfgLoading] = React.useState(true);
  const [cfgError, setCfgError] = React.useState<string | null>(null);
  const [base, setBase] = React.useState<MemoryBase | null>(null);
  const [draft, setDraft] = React.useState<MemoryDraft>({
    enabled: false,
    host: "127.0.0.1",
    port: "8788",
    recentTurns: "8",
    recallLimit: "20",
    timeoutMs: "1200",
    embeddingsModel: "all-MiniLM-L6-v2"
  });
  const [saving, setSaving] = React.useState(false);
  const [embLang, setEmbLang] = React.useState<EmbeddingLanguage>(() => inferLanguage(draft.embeddingsModel));
  const [modelStatus, setModelStatus] = React.useState<ModelStatus>("unknown");
  const [modelActionError, setModelActionError] = React.useState<string | null>(null);

  // Check model cache status when the model name or base config changes.
  const checkStatus = React.useCallback(async (model: string) => {
    const m = model.trim();
    if (!m) { setModelStatus("unknown"); return; }
    setModelStatus("checking");
    setModelActionError(null);
    const cached = await checkModelCached(m);
    if (cached === null) setModelStatus("error");
    else setModelStatus(cached ? "cached" : "not_cached");
  }, []);

  // Re-check when draft model changes (debounced).
  React.useEffect(() => {
    if (!base) { setModelStatus("unknown"); return; }
    const t = setTimeout(() => void checkStatus(draft.embeddingsModel), 400);
    return () => clearTimeout(t);
  }, [base, draft.embeddingsModel, checkStatus]);

  const handleDownload = async () => {
    const model = draft.embeddingsModel.trim();
    if (!model) return;
    setModelStatus("downloading");
    setModelActionError(null);
    const r = await downloadModel(model);
    if (r.ok) {
      setModelStatus("cached");
    } else {
      setModelStatus("error");
      const raw = r.error ?? "Download failed";
      setModelActionError(
        raw === "sidecar unreachable" || raw === "embeddings sidecar not running"
          ? "Embeddings sidecar not running — set memory.embeddings.model in config and restart the memory service."
          : raw
      );
    }
  };

  const handleDelete = async () => {
    const model = draft.embeddingsModel.trim();
    if (!model) return;
    const ok = window.confirm(`Delete cached model "${model}" from disk?`);
    if (!ok) return;
    setModelStatus("deleting");
    setModelActionError(null);
    const r = await deleteModel(model);
    if (r.ok) {
      setModelStatus("not_cached");
    } else {
      setModelStatus("error");
      setModelActionError(r.error ?? "Delete failed");
    }
  };

  const load = React.useCallback(async () => {
    setCfgLoading(true);
    setCfgError(null);

    try {
      const r = (await fetchDevConfig()) as ConfigResponse;
      if (!r?.ok) throw new Error((r as any)?.hint || (r as any)?.error || "Failed to load config.");

      const nextBase = readMemoryBase((r as any).config);
      setBase(nextBase);
      setDraft(baseToDraft(nextBase));
      setEmbLang(inferLanguage(nextBase.embeddingsModel));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load config.";
      setCfgError(msg);
      setBase(null);
    } finally {
      setCfgLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const devDisabled = cfgLoading || !base;

  const dirty = React.useMemo(() => {
    if (!base) return false;

    const hostDirty = draft.host.trim() !== base.host;
    const portDirty = portNumber(draft.port) !== base.port;
    const recentDirty = intOrNull(draft.recentTurns, 0, 64) !== base.recentTurns;
    const limitDirty = intOrNull(draft.recallLimit, 0, 200) !== base.recallLimit;
    const timeoutDirty = intOrNull(draft.timeoutMs, 50, 60_000) !== base.timeoutMs;
    const embDirty = draft.embeddingsModel.trim() !== base.embeddingsModel;

    return draft.enabled !== base.enabled || hostDirty || portDirty || recentDirty || limitDirty || timeoutDirty || embDirty;
  }, [base, draft.enabled, draft.host, draft.port, draft.recentTurns, draft.recallLimit, draft.timeoutMs, draft.embeddingsModel]);

  const valid = React.useMemo(() => {
    // Allow invalid draft when disabled, so the user can disable the service even if fields are blank.
    if (!draft.enabled) return true;

    const hostOk = draft.host.trim().length > 0;
    const portOk = isValidPort(draft.port);
    const recentOk = intOrNull(draft.recentTurns, 0, 64) !== null;
    const limitOk = intOrNull(draft.recallLimit, 0, 200) !== null;
    const timeoutOk = intOrNull(draft.timeoutMs, 50, 60_000) !== null;
    const embOk = draft.embeddingsModel.trim().length > 0;

    return hostOk && portOk && recentOk && limitOk && timeoutOk && embOk;
  }, [draft.enabled, draft.host, draft.port, draft.recentTurns, draft.recallLimit, draft.timeoutMs, draft.embeddingsModel]);

  const canSave = dirty && valid && !saving && !cfgLoading && Boolean(base);

  const discard = () => {
    if (!base || saving) return;
    setDraft(baseToDraft(base));
    setEmbLang(inferLanguage(base.embeddingsModel));
    setCfgError(null);
  };

  const save = async () => {
    if (!base) return;
    if (!dirty || saving) return;
    if (!valid) return;

    const port = portNumber(draft.port);
    const recentTurns = intOrNull(draft.recentTurns, 0, 64);
    const recallLimit = intOrNull(draft.recallLimit, 0, 200);
    const timeoutMs = intOrNull(draft.timeoutMs, 50, 60_000);

    if (draft.enabled && (!port || recentTurns === null || recallLimit === null || timeoutMs === null)) return;

    const body: ConfigRequestBody = {
      memory: {
        enabled: draft.enabled,
        host: draft.host.trim(),
        port: port ?? base.port,
        recent_turns: recentTurns ?? base.recentTurns,
        recall_limit: recallLimit ?? base.recallLimit,
        timeout_ms: timeoutMs ?? base.timeoutMs,
        embeddings: { model: draft.embeddingsModel.trim() }
      } as any
    };

    setSaving(true);
    setCfgError(null);

    try {
      const r = (await saveDevConfig(body)) as ConfigResponse;
      if (!r?.ok) throw new Error((r as any)?.hint || (r as any)?.error || "Failed to save config.");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save config.";
      setCfgError(msg);
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    if (dirty || saving) return;
    onBack();
  };

  return (
    <div className="settingsview motion-page">
      <div className="settings-head">
        <button className="btn icon" onClick={back} aria-label="Back" disabled={dirty || saving}>
          ←
        </button>

        <div className="settings-head-title">
          <EcliaLogo size="md" onClick={back} disabled={dirty || saving} />
          <div className="settings-title">Memory</div>
        </div>

        <div className="settings-head-actions">
          {dirty ? (
            <div className="saveIndicator" role="status" aria-live="polite">
              <span className="saveDot" aria-hidden="true" />
              Unsaved changes
            </div>
          ) : null}

          <button className="btn subtle" onClick={discard} disabled={!dirty || saving} aria-label="Discard changes">
            Discard
          </button>

          <button className="btn subtle" onClick={save} disabled={!canSave} aria-label="Save memory settings">
            {saving ? "Saving…" : "Save"}
          </button>

          <ThemeModeSwitch compact />
        </div>
      </div>

      <div className="settings-body">
        <div className="settings-content" style={{ width: "100%" }}>
          <div className="settings-section motion-item">
            {!base ? (
              <div className="devNoteText muted">Config service unavailable. Start the backend (pnpm dev:all) to edit memory settings.</div>
            ) : null}

            {cfgError ? (
              <div className="devNoteText" style={{ color: "var(--danger)" }}>
                {cfgError}
              </div>
            ) : null}

            <SettingsToggleRow
              title="Enable memory"
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
              ariaLabel="Enable memory"
              disabled={devDisabled}
            />

            {dirty && !valid ? (
              <div className="devNoteText" style={{ color: "var(--danger)" }}>
                Memory settings are invalid. Provide a host, valid port, numeric limits, and an embeddings model.
              </div>
            ) : null}

            <div className="card">
              <div className="card-title">Connection</div>

              <div className="grid2">
                <label className="field">
                  <div className="field-label">Host</div>
                  <input
                    className="select"
                    value={draft.host}
                    onChange={(e) => setDraft((d) => ({ ...d, host: e.target.value }))}
                    placeholder="127.0.0.1"
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>

                <label className="field">
                  <div className="field-label">Port</div>
                  <input
                    className="select"
                    value={draft.port}
                    onChange={(e) => setDraft((d) => ({ ...d, port: e.target.value }))}
                    placeholder="8788"
                    inputMode="numeric"
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>
              </div>

              <div className="profileActions" style={{ marginTop: 10 }}>
                <button type="button" className="btn subtle" onClick={() => void load()} disabled={cfgLoading || saving}>
                  Reload
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Recall</div>

              <div className="grid2">
                <label className="field">
                  <div className="field-label">Recent transcript turns</div>
                  <input
                    className="select"
                    value={draft.recentTurns}
                    onChange={(e) => setDraft((d) => ({ ...d, recentTurns: e.target.value }))}
                    placeholder="8"
                    inputMode="numeric"
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                  <div className="field-sub">Gateway includes last N user-turns in /recall request.</div>
                </label>

                <label className="field">
                  <div className="field-label">Recall limit</div>
                  <input
                    className="select"
                    value={draft.recallLimit}
                    onChange={(e) => setDraft((d) => ({ ...d, recallLimit: e.target.value }))}
                    placeholder="20"
                    inputMode="numeric"
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                  <div className="field-sub">Maximum memory items requested per recall.</div>
                </label>
              </div>

              <SettingsAdvancedSection>
                <div className="grid2 stack-gap">
                  <label className="field">
                    <div className="field-label">Request timeout (ms)</div>
                    <input
                      className="select"
                      value={draft.timeoutMs}
                      onChange={(e) => setDraft((d) => ({ ...d, timeoutMs: e.target.value }))}
                      placeholder="1200"
                      inputMode="numeric"
                      spellCheck={false}
                      disabled={devDisabled}
                    />
                    <div className="field-sub">Abort /recall request if it exceeds this duration.</div>
                  </label>

                  <div className="field" aria-hidden="true" />
                </div>
              </SettingsAdvancedSection>
            </div>

            <div className="card">
              <div className="card-title">Embeddings</div>

              <div className="grid2">
                <label className="field">
                  <div className="field-label">Language</div>
                  <select
                    className="select"
                    value={embLang}
                    onChange={(e) => {
                      const lang = e.target.value as EmbeddingLanguage;
                      setEmbLang(lang);
                      const first = EMBEDDING_MODELS[lang]?.[0];
                      if (first) setDraft((d) => ({ ...d, embeddingsModel: first.value }));
                    }}
                    disabled={devDisabled}
                  >
                    {LANGUAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <div className="field-sub">Filter recommended models by language.</div>
                </label>

                <label className="field">
                  <div className="field-label">Model</div>
                  {(() => {
                    const models = EMBEDDING_MODELS[embLang];
                    const isCustom = !models.some((m) => m.value === draft.embeddingsModel);
                    return (
                      <>
                        <select
                          className="select"
                          value={isCustom ? "__custom__" : draft.embeddingsModel}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom__") {
                              setDraft((d) => ({ ...d, embeddingsModel: "" }));
                              return;
                            }
                            setDraft((d) => ({ ...d, embeddingsModel: v }));
                          }}
                          disabled={devDisabled}
                        >
                          {models.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                          <option value="__custom__">Custom…</option>
                        </select>
                        {isCustom ? (
                          <input
                            className="select"
                            style={{ marginTop: 6 }}
                            value={draft.embeddingsModel}
                            onChange={(e) => setDraft((d) => ({ ...d, embeddingsModel: e.target.value }))}
                            placeholder="org/model-name"
                            spellCheck={false}
                            disabled={devDisabled}
                          />
                        ) : null}
                      </>
                    );
                  })()}
                  <div className="field-sub">Select a recommended model or choose Custom to enter any HuggingFace model name.</div>
                </label>
              </div>

              {draft.embeddingsModel.trim() ? (
                <div className="profileActions" style={{ marginTop: 10, gap: 8, alignItems: "center" }}>
                  {modelStatus === "checking" ? (
                    <span className="field-sub">Checking…</span>
                  ) : modelStatus === "downloading" ? (
                    <span className="field-sub">Downloading model (this may take a while)…</span>
                  ) : modelStatus === "deleting" ? (
                    <span className="field-sub">Deleting…</span>
                  ) : modelStatus === "cached" ? (
                    <>
                      <span className="field-sub" style={{ color: "var(--success, #4a4)" }}>Cached locally</span>
                      <button type="button" className="btn subtle" onClick={() => void handleDelete()} disabled={saving}>
                        Delete
                      </button>
                    </>
                  ) : modelStatus === "not_cached" ? (
                    <>
                      <span className="field-sub">Not downloaded</span>
                      <button type="button" className="btn subtle" onClick={() => void handleDownload()} disabled={saving}>
                        Download
                      </button>
                    </>
                  ) : modelStatus === "error" ? (
                    <>
                      <span className="field-sub muted">
                        {modelActionError ?? "Memory service not running — start it to check model status."}
                      </span>
                      <button type="button" className="btn subtle" onClick={() => void checkStatus(draft.embeddingsModel)}>
                        Retry
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="devNoteText muted">
              Tip: edit <code>_system_memory.local.md</code> to control how retrieved context is injected. The placeholder is <code>{"{{RETRIEVED_CONTEXT}}"}</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
