import React from "react";

import { SettingsAdvancedSection } from "../../settings/components/SettingsAdvancedSection";
import { SettingsToggleRow } from "../../settings/components/SettingsToggleRow";
import { EMBEDDING_MODELS, LANGUAGE_OPTIONS } from "../memoryTypes";
import type { EmbeddingLanguage, MemoryBase, MemoryDraft, ModelStatus } from "../memoryTypes";
import type { GenesisStatus } from "../memoryApi";
import { ModelRouteSelect } from "../../settings/components/ModelRouteSelect";
import type { ModelRouteOption } from "../../settings/settingsUtils";

export type MemorySettingsSectionProps = {
  base: MemoryBase | null;
  draft: MemoryDraft;
  setDraft: React.Dispatch<React.SetStateAction<MemoryDraft>>;
  cfgLoading: boolean;
  cfgError: string | null;
  saving: boolean;
  devDisabled: boolean;
  dirty: boolean;
  valid: boolean;
  embLang: EmbeddingLanguage;
  setEmbLang: React.Dispatch<React.SetStateAction<EmbeddingLanguage>>;
  modelStatus: ModelStatus;
  modelActionError: string | null;
  onReloadConfig: () => void;
  onCheckStatus: (model: string) => void;
  onDownloadModel: () => void;
  onDeleteModel: () => void;
  genesisStatus: GenesisStatus | null;
  genesisStarting: boolean;
  genesisError: string | null;
  genesisModel: string;
  setGenesisModel: (model: string) => void;
  modelRouteOptions: ModelRouteOption[];
  onStartGenesis: () => void;
};

export function MemorySettingsSection(props: MemorySettingsSectionProps) {
  const {
    base,
    draft,
    setDraft,
    cfgLoading,
    cfgError,
    saving,
    devDisabled,
    dirty,
    valid,
    embLang,
    setEmbLang,
    modelStatus,
    modelActionError,
    onReloadConfig,
    onCheckStatus,
    onDownloadModel,
    onDeleteModel,
    genesisStatus,
    genesisStarting,
    genesisError,
    genesisModel,
    setGenesisModel,
    modelRouteOptions,
    onStartGenesis
  } = props;

  return (
    <>
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

          <label className="field">
            <div className="field-label">Min score</div>
            <input
              className="select"
              value={draft.recallMinScore}
              onChange={(e) => setDraft((d) => ({ ...d, recallMinScore: e.target.value }))}
              placeholder="0.6"
              inputMode="decimal"
              spellCheck={false}
              disabled={devDisabled}
            />
            <div className="field-sub">Cosine similarity threshold (0–1). Below this, memories are not injected.</div>
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
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="field-sub">Filter recommended models by language.</div>
          </label>

          <label className="field">
            <div className="field-label">Model</div>
            {(() => {
              const models = EMBEDDING_MODELS[embLang];
              const isCustom = !models.some((model) => model.value === draft.embeddingsModel);

              return (
                <>
                  <select
                    className="select"
                    value={isCustom ? "__custom__" : draft.embeddingsModel}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "__custom__") {
                        setDraft((d) => ({ ...d, embeddingsModel: "" }));
                        return;
                      }
                      setDraft((d) => ({ ...d, embeddingsModel: value }));
                    }}
                    disabled={devDisabled}
                  >
                    {models.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
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
                <span className="field-sub" style={{ color: "var(--success, #4a4)" }}>
                  Cached locally
                </span>
                <button type="button" className="btn subtle" onClick={onDeleteModel} disabled={saving}>
                  Delete
                </button>
              </>
            ) : modelStatus === "not_cached" ? (
              <>
                <span className="field-sub">Not downloaded</span>
                <button type="button" className="btn subtle" onClick={onDownloadModel} disabled={saving}>
                  Download
                </button>
              </>
            ) : modelStatus === "error" ? (
              <>
                <span className="field-sub muted">{modelActionError ?? "Memory service not running — start it to check model status."}</span>
                <button type="button" className="btn subtle" onClick={() => onCheckStatus(draft.embeddingsModel)}>
                  Retry
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-title">Genesis</div>

        <div className="grid2">
          <label className="field">
            <div className="field-label">Turns per model call</div>
            <input
              className="select"
              value={draft.genesisTurnsPerCall}
              onChange={(e) => setDraft((d) => ({ ...d, genesisTurnsPerCall: e.target.value }))}
              placeholder="20"
              inputMode="numeric"
              spellCheck={false}
              disabled={devDisabled}
            />
            <div className="field-sub">Chunk size (in user-turns) for Stage 1/2 extraction prompts.</div>
          </label>

          <label className="field">
            <div className="field-label">Model</div>
            <ModelRouteSelect
              value={genesisModel}
              onChange={setGenesisModel}
              options={modelRouteOptions}
              disabled={devDisabled || Boolean(genesisStatus?.active)}
            />
            <div className="field-sub">Model to use for genesis. Default uses the active inference profile.</div>
          </label>
        </div>

        <div className="profileActions" style={{ marginTop: 10, gap: 8, alignItems: "center" }}>
          {genesisStatus?.active ? (
            <>
              <span className="field-sub">
                {genesisStatus.active.stage === "stage1_extract"
                  ? `Extracting… ${genesisStatus.active.processedSessions} sessions, ${genesisStatus.active.processedChunks} chunks, ${genesisStatus.active.extractedFacts} facts`
                  : genesisStatus.active.stage === "stage2_consolidate"
                    ? `Consolidating… ${genesisStatus.active.extractedFacts} facts`
                    : `Running (${genesisStatus.active.stage})…`}
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn subtle"
                onClick={onStartGenesis}
                disabled={devDisabled || genesisStarting}
              >
                {genesisStarting ? "Starting…" : "Run Genesis"}
              </button>

              {genesisError ? (
                <span className="field-sub" style={{ color: "var(--danger)" }}>{genesisError}</span>
              ) : genesisStatus?.last ? (
                <span className="field-sub" style={{ color: genesisStatus.last.stage === "error" ? "var(--danger)" : "var(--success, #4a4)" }}>
                  {genesisStatus.last.stage === "error"
                    ? `Error: ${genesisStatus.last.error ?? "unknown"}`
                    : `Done — ${genesisStatus.last.extractedFacts} facts, ${genesisStatus.last.processedSessions} sessions`}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>

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
          <button type="button" className="btn subtle" onClick={onReloadConfig} disabled={cfgLoading || saving}>
            Reload
          </button>
        </div>
      </div>

      <div className="devNoteText muted">
        Tip: edit <code>_system_memory.local.md</code> to control how retrieved context is injected. The placeholder is{" "}
        <code>{"{{RETRIEVED_CONTEXT}}"}</code>.
      </div>
    </>
  );
}
