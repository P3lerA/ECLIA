import React from "react";

import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { EcliaLogo } from "../common/EcliaLogo";

import { fetchDevConfig, saveDevConfig } from "../settings/settingsInteractions";
import type { ConfigRequestBody, ConfigResponse } from "../settings/settingsTypes";
import { isValidPort, portNumber } from "../settings/settingsUtils";
import { checkModelCached, createMemory, deleteMemoryItem, deleteModel, downloadModel, fetchGenesisStatus, listMemories, startGenesis } from "./memoryApi";
import type { GenesisStatus } from "./memoryApi";
import { buildModelRouteOptions } from "../settings/settingsUtils";
import type { ModelRouteOption } from "../settings/settingsUtils";
import { MemoryManageSection } from "./sections/MemoryManageSection";
import { MemorySettingsSection } from "./sections/MemorySettingsSection";
import { MemoryToolSection } from "./sections/MemoryToolSection";
import { DEFAULT_MEMORY_DRAFT, MEMORY_SECTIONS } from "./memoryTypes";
import type { EmbeddingLanguage, MemoryBase, MemoryDraft, MemoryManageItem, MemorySectionId, ModelStatus } from "./memoryTypes";
import { baseToDraft, floatOrNull, inferLanguage, intOrNull, parseStrength, readMemoryBase } from "./memoryUtils";

/**
 * Memory settings uses an explicit "Save" to commit changes.
 * While dirty, leaving the page is blocked to avoid accidental loss.
 */
export function MemoryView({ onBack }: { onBack: () => void }) {
  const [activeSection, setActiveSection] = React.useState<MemorySectionId>("settings");

  const [cfgLoading, setCfgLoading] = React.useState(true);
  const [cfgError, setCfgError] = React.useState<string | null>(null);
  const [base, setBase] = React.useState<MemoryBase | null>(null);
  const [draft, setDraft] = React.useState<MemoryDraft>(() => ({ ...DEFAULT_MEMORY_DRAFT }));
  const [saving, setSaving] = React.useState(false);

  const [embLang, setEmbLang] = React.useState<EmbeddingLanguage>(() => inferLanguage(DEFAULT_MEMORY_DRAFT.embeddingsModel));
  const [modelStatus, setModelStatus] = React.useState<ModelStatus>("unknown");
  const [modelActionError, setModelActionError] = React.useState<string | null>(null);

  const [manageQuery, setManageQuery] = React.useState("");
  const [manageLoading, setManageLoading] = React.useState(false);
  const [manageError, setManageError] = React.useState<string | null>(null);
  const [manageItems, setManageItems] = React.useState<MemoryManageItem[]>([]);

  const [newRaw, setNewRaw] = React.useState("");
  const [newStrength, setNewStrength] = React.useState("1");
  const [newError, setNewError] = React.useState<string | null>(null);
  const [newSaving, setNewSaving] = React.useState(false);

  const [genesisStatus, setGenesisStatus] = React.useState<GenesisStatus | null>(null);
  const [genesisStarting, setGenesisStarting] = React.useState(false);
  const [genesisError, setGenesisError] = React.useState<string | null>(null);
  const [genesisModel, setGenesisModel] = React.useState("");
  const [modelRouteOptions, setModelRouteOptions] = React.useState<ModelRouteOption[]>([]);
  const genesisPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const pollGenesis = React.useCallback(async () => {
    const s = await fetchGenesisStatus();
    if (s) setGenesisStatus(s);
    // Stop polling when no longer running.
    if (s && !s.active && genesisPollRef.current) {
      clearInterval(genesisPollRef.current);
      genesisPollRef.current = null;
    }
  }, []);

  const handleStartGenesis = React.useCallback(async () => {
    setGenesisStarting(true);
    setGenesisError(null);
    const result = await startGenesis(genesisModel ? { model: genesisModel } : undefined);
    setGenesisStarting(false);
    if (!result.ok) {
      setGenesisError(result.error ?? "Failed to start genesis");
      return;
    }
    // Start polling.
    void pollGenesis();
    if (genesisPollRef.current) clearInterval(genesisPollRef.current);
    genesisPollRef.current = setInterval(() => void pollGenesis(), 3000);
  }, [genesisModel, pollGenesis]);

  // Fetch genesis status on mount + cleanup polling.
  React.useEffect(() => {
    void pollGenesis();
    return () => {
      if (genesisPollRef.current) clearInterval(genesisPollRef.current);
    };
  }, [pollGenesis]);

  // Resume polling if active.
  React.useEffect(() => {
    if (genesisStatus?.active && !genesisPollRef.current) {
      genesisPollRef.current = setInterval(() => void pollGenesis(), 3000);
    }
  }, [genesisStatus, pollGenesis]);

  const checkStatus = React.useCallback(async (model: string) => {
    const clean = model.trim();
    if (!clean) {
      setModelStatus("unknown");
      return;
    }

    setModelStatus("checking");
    setModelActionError(null);

    const cached = await checkModelCached(clean);
    if (cached === null) {
      setModelStatus("error");
    } else {
      setModelStatus(cached ? "cached" : "not_cached");
    }
  }, []);

  React.useEffect(() => {
    if (!base) {
      setModelStatus("unknown");
      return;
    }

    const timer = setTimeout(() => void checkStatus(draft.embeddingsModel), 400);
    return () => clearTimeout(timer);
  }, [base, draft.embeddingsModel, checkStatus]);

  const handleDownload = async () => {
    const model = draft.embeddingsModel.trim();
    if (!model) return;

    setModelStatus("downloading");
    setModelActionError(null);

    const result = await downloadModel(model);
    if (result.ok) {
      setModelStatus("cached");
      return;
    }

    setModelStatus("error");
    const raw = result.error ?? "Download failed";
    setModelActionError(
      raw === "sidecar unreachable" || raw === "embeddings sidecar not running"
        ? "Embeddings sidecar not running — set memory.embeddings.model in config and restart the memory service."
        : raw
    );
  };

  const handleDelete = async () => {
    const model = draft.embeddingsModel.trim();
    if (!model) return;

    const ok = window.confirm(`Delete cached model "${model}" from disk?`);
    if (!ok) return;

    setModelStatus("deleting");
    setModelActionError(null);

    const result = await deleteModel(model);
    if (result.ok) {
      setModelStatus("not_cached");
      return;
    }

    setModelStatus("error");
    setModelActionError(result.error ?? "Delete failed");
  };

  const load = React.useCallback(async () => {
    setCfgLoading(true);
    setCfgError(null);

    try {
      const response = (await fetchDevConfig()) as ConfigResponse;
      if (!response?.ok) throw new Error((response as any)?.hint || (response as any)?.error || "Failed to load config.");

      const cfg = (response as any).config;
      const nextBase = readMemoryBase(cfg);
      setBase(nextBase);
      setDraft(baseToDraft(nextBase));
      setEmbLang(inferLanguage(nextBase.embeddingsModel));

      const oai = cfg?.inference?.openai_compat?.profiles;
      const anth = cfg?.inference?.anthropic?.profiles;
      const codex = cfg?.inference?.codex_oauth?.profiles;
      setModelRouteOptions(buildModelRouteOptions(oai, anth, codex));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to load config.";
      setCfgError(msg);
      setBase(null);
    } finally {
      setCfgLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadManage = React.useCallback(async () => {
    setManageLoading(true);
    setManageError(null);

    try {
      const rows = await listMemories({ q: "", limit: 500, offset: 0 });
      if (!rows) throw new Error("Memory service unreachable.");
      setManageItems(rows);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to load memories.";
      setManageError(msg);
      setManageItems([]);
    } finally {
      setManageLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (activeSection !== "manage") return;
    void loadManage();
  }, [activeSection, loadManage]);

  const devDisabled = cfgLoading || !base;

  const dirty = React.useMemo(() => {
    if (!base) return false;

    const hostDirty = draft.host.trim() !== base.host;
    const portDirty = portNumber(draft.port) !== base.port;
    const recentDirty = intOrNull(draft.recentTurns, 0, 64) !== base.recentTurns;
    const limitDirty = intOrNull(draft.recallLimit, 0, 200) !== base.recallLimit;
    const minScoreDirty = floatOrNull(draft.recallMinScore, 0, 1) !== base.recallMinScore;
    const timeoutDirty = intOrNull(draft.timeoutMs, 50, 60_000) !== base.timeoutMs;
    const embDirty = draft.embeddingsModel.trim() !== base.embeddingsModel;
    const genesisTurnsDirty = intOrNull(draft.genesisTurnsPerCall, 1, 64) !== base.genesisTurnsPerCall;

    const extractModeDirty = draft.extractToolMessages !== base.extractToolMessages;
    const extractMaxCharsDirty = intOrNull(draft.extractToolMaxCharsPerMsg, 0, 50_000) !== base.extractToolMaxCharsPerMsg;
    const extractMaxTotalDirty = intOrNull(draft.extractToolMaxTotalChars, 0, 200_000) !== base.extractToolMaxTotalChars;

    return (
      draft.enabled !== base.enabled ||
      hostDirty ||
      portDirty ||
      recentDirty ||
      limitDirty ||
      minScoreDirty ||
      timeoutDirty ||
      embDirty ||
      genesisTurnsDirty ||
      extractModeDirty ||
      extractMaxCharsDirty ||
      extractMaxTotalDirty
    );
  }, [base, draft]);

  const valid = React.useMemo(() => {
    if (!draft.enabled) return true;

    const hostOk = draft.host.trim().length > 0;
    const portOk = isValidPort(draft.port);
    const recentOk = intOrNull(draft.recentTurns, 0, 64) !== null;
    const limitOk = intOrNull(draft.recallLimit, 0, 200) !== null;
    const minScoreOk = floatOrNull(draft.recallMinScore, 0, 1) !== null;
    const timeoutOk = intOrNull(draft.timeoutMs, 50, 60_000) !== null;
    const embOk = draft.embeddingsModel.trim().length > 0;
    const genesisTurnsOk = intOrNull(draft.genesisTurnsPerCall, 1, 64) !== null;

    const extractMaxCharsOk = intOrNull(draft.extractToolMaxCharsPerMsg, 0, 50_000) !== null;
    const extractMaxTotalOk = intOrNull(draft.extractToolMaxTotalChars, 0, 200_000) !== null;

    return (
      hostOk && portOk && recentOk && limitOk && minScoreOk && timeoutOk && embOk && genesisTurnsOk && extractMaxCharsOk && extractMaxTotalOk
    );
  }, [draft]);

  const canSave = dirty && valid && !saving && !cfgLoading && Boolean(base);

  const filteredManageItems = React.useMemo(() => {
    const q = manageQuery.trim().toLowerCase();
    if (!q) return manageItems;
    return manageItems.filter((item) => item.raw.toLowerCase().includes(q) || item.id.toLowerCase().includes(q));
  }, [manageItems, manageQuery]);

  const discard = () => {
    if (!base || saving) return;

    setDraft(baseToDraft(base));
    setEmbLang(inferLanguage(base.embeddingsModel));
    setCfgError(null);
  };

  const save = async () => {
    if (!base || !dirty || saving || !valid) return;

    const port = portNumber(draft.port);
    const recentTurns = intOrNull(draft.recentTurns, 0, 64);
    const recallLimit = intOrNull(draft.recallLimit, 0, 200);
    const recallMinScore = floatOrNull(draft.recallMinScore, 0, 1);
    const timeoutMs = intOrNull(draft.timeoutMs, 50, 60_000);
    const genesisTurnsPerCall = intOrNull(draft.genesisTurnsPerCall, 1, 64);
    const extractToolMaxCharsPerMsg = intOrNull(draft.extractToolMaxCharsPerMsg, 0, 50_000);
    const extractToolMaxTotalChars = intOrNull(draft.extractToolMaxTotalChars, 0, 200_000);

    if (
      draft.enabled &&
      (!port ||
        recentTurns === null ||
        recallLimit === null ||
        recallMinScore === null ||
        timeoutMs === null ||
        genesisTurnsPerCall === null ||
        extractToolMaxCharsPerMsg === null ||
        extractToolMaxTotalChars === null)
    )
      return;

    const body: ConfigRequestBody = {
      memory: {
        enabled: draft.enabled,
        host: draft.host.trim(),
        port: port ?? base.port,
        recent_turns: recentTurns ?? base.recentTurns,
        recall_limit: recallLimit ?? base.recallLimit,
        recall_min_score: recallMinScore ?? base.recallMinScore,
        timeout_ms: timeoutMs ?? base.timeoutMs,
        embeddings: { model: draft.embeddingsModel.trim() },
        genesis: { turns_per_call: genesisTurnsPerCall ?? base.genesisTurnsPerCall },
        extract: {
          tool_messages: draft.extractToolMessages,
          tool_max_chars_per_msg: extractToolMaxCharsPerMsg ?? base.extractToolMaxCharsPerMsg,
          tool_max_total_chars: extractToolMaxTotalChars ?? base.extractToolMaxTotalChars
        }
      } as any
    };

    setSaving(true);
    setCfgError(null);

    try {
      const response = (await saveDevConfig(body)) as ConfigResponse;
      if (!response?.ok) throw new Error((response as any)?.hint || (response as any)?.error || "Failed to save config.");
      await load();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to save config.";
      setCfgError(msg);
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    if (dirty || saving) return;
    onBack();
  };

  const createNew = async () => {
    if (newSaving) return;

    const raw = newRaw.trim();
    const strengthNum = parseStrength(newStrength);

    if (!raw) {
      setNewError("Raw is required.");
      return;
    }

    if (strengthNum === null) {
      setNewError("Strength must be a number ≥ 0.");
      return;
    }

    setNewSaving(true);
    setNewError(null);

    const created = await createMemory({ raw, strength: strengthNum });
    if (!created) {
      setNewError("Failed to create memory (memory service unreachable).");
      setNewSaving(false);
      return;
    }

    setNewRaw("");
    setNewStrength("1");
    setNewSaving(false);
    void loadManage();
  };

  const updateInList = (next: MemoryManageItem) => {
    setManageItems((items) => items.map((item) => (item.id === next.id ? next : item)));
  };

  const deleteFromList = async (id: string) => {
    setManageLoading(true);
    setManageError(null);

    const ok = await deleteMemoryItem(id);
    if (!ok) {
      setManageError("Failed to delete memory (memory service unreachable).");
    } else {
      setManageItems((items) => items.filter((item) => item.id !== id));
    }

    setManageLoading(false);
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
        <aside className="settings-sidebar" aria-label="Memory navigation">
          <nav className="settings-nav" aria-label="Memory sections">
            {MEMORY_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className="settings-nav-btn"
                data-active={activeSection === section.id ? "true" : "false"}
                aria-current={activeSection === section.id ? "page" : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-content">
          <div key={activeSection} className="settings-section motion-item">
            {activeSection === "settings" ? (
              <MemorySettingsSection
                base={base}
                draft={draft}
                setDraft={setDraft}
                cfgLoading={cfgLoading}
                cfgError={cfgError}
                saving={saving}
                devDisabled={devDisabled}
                dirty={dirty}
                valid={valid}
                embLang={embLang}
                setEmbLang={setEmbLang}
                modelStatus={modelStatus}
                modelActionError={modelActionError}
                onReloadConfig={() => void load()}
                onCheckStatus={(model) => void checkStatus(model)}
                onDownloadModel={() => void handleDownload()}
                onDeleteModel={() => void handleDelete()}
                genesisStatus={genesisStatus}
                genesisStarting={genesisStarting}
                genesisError={genesisError}
                genesisModel={genesisModel}
                setGenesisModel={setGenesisModel}
                modelRouteOptions={modelRouteOptions}
                onStartGenesis={() => void handleStartGenesis()}
              />
            ) : null}

            {activeSection === "manage" ? (
              <MemoryManageSection
                newRaw={newRaw}
                setNewRaw={setNewRaw}
                newStrength={newStrength}
                setNewStrength={setNewStrength}
                newError={newError}
                newSaving={newSaving}
                onCreateNew={() => void createNew()}
                manageQuery={manageQuery}
                setManageQuery={setManageQuery}
                manageLoading={manageLoading}
                manageError={manageError}
                filteredManageItems={filteredManageItems}
                onReloadManage={() => void loadManage()}
                onItemChange={updateInList}
                onItemDelete={(id) => void deleteFromList(id)}
              />
            ) : null}

            {activeSection === "tool" ? (
              <MemoryToolSection base={base} draft={draft} setDraft={setDraft} devDisabled={devDisabled} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
