import React from "react";
import { runtime } from "../../core/runtime";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { EcliaLogo } from "../common/EcliaLogo";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { useStagedDraft } from "../common/useStagedDraft";
import type { CfgBase, SettingsDraft } from "./settingsTypes";
import { fetchDevConfig, saveDevConfig } from "./settingsInteractions";
import { applyDevConfigPatchToCfgBase, buildDevConfigPatch, devConfigToCfgBase, draftAfterDevSave } from "./settingsDevConfigModel";
import {
  isValidPort,
  normalizeActiveModel,
  normalizeGuildIds,
  parseContextLimit,
  parseWebResultTruncateChars,
  portNumber,
  sameCodexOAuthProfiles,
  sameOpenAICompatProfiles,
  sameWebProfiles,
  sameStringArray
} from "./settingsUtils";
import { AdaptersSection } from "./sections/adapters/AdaptersSection";
import { AppearanceSection } from "./sections/appearance/AppearanceSection";
import { GeneralSection } from "./sections/general/GeneralSection";
import { InferenceSection } from "./sections/inference/InferenceSection";
import { useInferenceController } from "./sections/inference/useInferenceController";
import { SkillsSection } from "./sections/skills/SkillsSection";
import { ToolsSection } from "./sections/tools/ToolsSection";

const ALLOWED_CONSOLE_HOSTS = new Set(["127.0.0.1", "0.0.0.0"]);

/**
 * Settings uses an explicit "Save" to commit changes.
 * While dirty, leaving the page is blocked to avoid accidental loss.
 */
export function SettingsView({ onBack }: { onBack: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const transports = runtime.transports.list();

  // Dev config (TOML) is owned by the local backend (dev only).
  const [cfgLoading, setCfgLoading] = React.useState(false);
  const [cfgError, setCfgError] = React.useState<string | null>(null);
  const [cfgSaved, setCfgSaved] = React.useState<string | null>(null);

  const [cfgBase, setCfgBase] = React.useState<CfgBase | null>(null);

  // Load TOML config (best-effort).
  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setCfgLoading(true);
      setCfgError(null);
      setCfgSaved(null);

      try {
        const j = await fetchDevConfig();
        if (cancelled) return;
        if (!j.ok) throw new Error(j.hint ?? j.error);

        setCfgBase(devConfigToCfgBase(j.config));
      } catch {
        if (cancelled) return;
        // Dev config editing is optional; do not break Settings if the backend isn't running.
        setCfgError("Config service unavailable. Start the backend (pnpm dev:all) to edit TOML config.");
        setCfgBase(null);
      } finally {
        if (cancelled) return;
        setCfgLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const getCleanDraft = React.useCallback(
    (prev: SettingsDraft | undefined): SettingsDraft => {
      return {
        textureDisabled: state.settings.textureDisabled,
        sessionSyncEnabled: state.settings.sessionSyncEnabled,
        displayPlainOutput: Boolean(state.settings.displayPlainOutput ?? false),
        enabledTools: [...state.settings.enabledTools],
        debugCaptureUpstreamRequests: cfgBase ? cfgBase.debugCaptureUpstreamRequests : prev?.debugCaptureUpstreamRequests ?? false,
        debugParseAssistantOutput: cfgBase ? cfgBase.debugParseAssistantOutput : prev?.debugParseAssistantOutput ?? false,
        transport: state.transport,
        model: cfgBase ? normalizeActiveModel(state.model, cfgBase.openaiCompatProfiles) : state.model,
        contextTokenLimit: String(state.settings.contextTokenLimit ?? 20000),
        contextLimitEnabled: Boolean(state.settings.contextLimitEnabled ?? true),

        webResultTruncateChars: String(state.settings.webResultTruncateChars ?? 4000),

        consoleHost: cfgBase?.host ?? prev?.consoleHost ?? "",
        consolePort: cfgBase ? String(cfgBase.port) : prev?.consolePort ?? "",

        webActiveProfileId: cfgBase?.webActiveProfileId ?? prev?.webActiveProfileId ?? "default",
        webProfiles: cfgBase
          ? cfgBase.webProfiles.map((p) => ({
              id: p.id,
              name: p.name,
              provider: p.provider,
              projectId: p.projectId,
              apiKey: ""
            }))
          : prev?.webProfiles ?? [{ id: "default", name: "Default", provider: "tavily", apiKey: "", projectId: "" }],

        inferenceProfiles: cfgBase
          ? cfgBase.openaiCompatProfiles.map((p) => ({
              id: p.id,
              name: p.name,
              baseUrl: p.baseUrl,
              modelId: p.modelId,
              authHeader: p.authHeader,
              apiKey: ""
            }))
          : prev?.inferenceProfiles ?? [],

        codexOAuthProfiles: cfgBase
          ? cfgBase.codexOAuthProfiles.map((p) => ({ ...p })).slice(0, 1)
          : prev?.codexOAuthProfiles?.length
            ? [{ ...prev.codexOAuthProfiles[0], id: "default" }]
            : [{ id: "default", name: "Default", model: "gpt-5.2-codex" }],

        inferenceSystemInstruction: cfgBase ? cfgBase.systemInstruction : prev?.inferenceSystemInstruction ?? "",

        codexHomeOverrideEnabled: cfgBase ? Boolean(cfgBase.codexHome.trim().length) : prev?.codexHomeOverrideEnabled ?? false,
        codexHomeOverridePath: cfgBase ? cfgBase.codexHome : prev?.codexHomeOverridePath ?? "",

        adapterDiscordEnabled: cfgBase?.discordEnabled ?? prev?.adapterDiscordEnabled ?? false,
        adapterDiscordAppId: cfgBase?.discordAppId ?? prev?.adapterDiscordAppId ?? "",
        adapterDiscordBotToken: "",
        adapterDiscordGuildIds: cfgBase ? cfgBase.discordGuildIds.join("\n") : prev?.adapterDiscordGuildIds ?? "",
        adapterDiscordDefaultStreamMode: cfgBase?.discordDefaultStreamMode ?? prev?.adapterDiscordDefaultStreamMode ?? "final",

        skillsEnabled: cfgBase ? [...cfgBase.skillsEnabled] : prev?.skillsEnabled ?? []
      };
    },
    [
      state.settings.textureDisabled,
      state.settings.sessionSyncEnabled,
      state.settings.displayPlainOutput,
      state.settings.enabledTools,
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      state.settings.webResultTruncateChars,
      state.transport,
      state.model,
      cfgBase
    ]
  );

  const isDirtyDraft = React.useCallback(
    (d: SettingsDraft): boolean => {
      const effectiveStateModel = cfgBase ? normalizeActiveModel(state.model, cfgBase.openaiCompatProfiles) : state.model;

      const dirtyUi =
        d.textureDisabled !== state.settings.textureDisabled ||
        d.sessionSyncEnabled !== state.settings.sessionSyncEnabled ||
        d.displayPlainOutput !== Boolean(state.settings.displayPlainOutput ?? false) ||
        !sameStringArray(d.enabledTools, state.settings.enabledTools) ||
        d.transport !== state.transport ||
        d.model !== effectiveStateModel ||
        d.contextLimitEnabled !== state.settings.contextLimitEnabled ||
        parseContextLimit(d.contextTokenLimit) !== state.settings.contextTokenLimit ||
        parseWebResultTruncateChars(d.webResultTruncateChars) !== state.settings.webResultTruncateChars;

      const dirtyDevHostPort = cfgBase
        ? d.consoleHost.trim() !== cfgBase.host || portNumber(d.consolePort) !== cfgBase.port
        : false;

      const dirtyDevDebug = cfgBase ?
    d.debugCaptureUpstreamRequests !== cfgBase.debugCaptureUpstreamRequests ||
    d.debugParseAssistantOutput !== cfgBase.debugParseAssistantOutput
    : false;

      const dirtyDevInference = cfgBase
        ? !sameOpenAICompatProfiles(d.inferenceProfiles, cfgBase.openaiCompatProfiles) ||
          !sameCodexOAuthProfiles(d.codexOAuthProfiles, cfgBase.codexOAuthProfiles) ||
          d.inferenceProfiles.some((p) => p.apiKey.trim().length > 0) ||
          d.inferenceSystemInstruction.trim() !== (cfgBase.systemInstruction ?? "").trim()
        : false;

      const dirtyDevCodexHome = cfgBase
        ? (d.codexHomeOverrideEnabled ? d.codexHomeOverridePath.trim() : "") !== cfgBase.codexHome.trim()
        : false;

      const dirtyDevDiscord = cfgBase
        ? d.adapterDiscordEnabled !== cfgBase.discordEnabled ||
          d.adapterDiscordAppId.trim() !== cfgBase.discordAppId ||
          d.adapterDiscordBotToken.trim().length > 0 ||
          !sameStringArray(normalizeGuildIds(d.adapterDiscordGuildIds), cfgBase.discordGuildIds) ||
          d.adapterDiscordDefaultStreamMode !== cfgBase.discordDefaultStreamMode
        : false;

      const dirtyDevSkills = cfgBase ? !sameStringArray(d.skillsEnabled, cfgBase.skillsEnabled) : false;

      const dirtyDevWeb = cfgBase
        ? d.webActiveProfileId !== cfgBase.webActiveProfileId ||
          !sameWebProfiles(d.webProfiles, cfgBase.webProfiles) ||
          d.webProfiles.some((p) => p.apiKey.trim().length > 0)
        : false;

      return (
        dirtyUi ||
        dirtyDevHostPort ||
        dirtyDevDebug ||
        dirtyDevInference ||
        dirtyDevCodexHome ||
        dirtyDevDiscord ||
        dirtyDevWeb ||
        dirtyDevSkills
      );
    },
    [
      state.settings.textureDisabled,
      state.settings.sessionSyncEnabled,
      state.settings.displayPlainOutput,
      state.settings.enabledTools,
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      state.settings.webResultTruncateChars,
      state.transport,
      state.model,
      cfgBase
    ]
  );

  const { draft, setDraft, dirty, discard: discardDraft } = useStagedDraft<SettingsDraft>({
    getCleanDraft,
    isDirty: isDirtyDraft,
    syncDeps: [
      state.settings.textureDisabled,
      state.settings.sessionSyncEnabled,
      state.settings.displayPlainOutput,
      state.settings.enabledTools,
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      state.settings.webResultTruncateChars,
      state.transport,
      state.model,
      cfgBase
    ]
  });

  const dirtyDevHostPort = cfgBase
    ? draft.consoleHost.trim() !== cfgBase.host || portNumber(draft.consolePort) !== cfgBase.port
    : false;

  const dirtyDevDebug = cfgBase ?
    draft.debugCaptureUpstreamRequests !== cfgBase.debugCaptureUpstreamRequests ||
    draft.debugParseAssistantOutput !== cfgBase.debugParseAssistantOutput
    : false;

  const dirtyDevInference = cfgBase
    ? !sameOpenAICompatProfiles(draft.inferenceProfiles, cfgBase.openaiCompatProfiles) ||
      !sameCodexOAuthProfiles(draft.codexOAuthProfiles, cfgBase.codexOAuthProfiles) ||
      draft.inferenceProfiles.some((p) => p.apiKey.trim().length > 0) ||
      draft.inferenceSystemInstruction.trim() !== (cfgBase.systemInstruction ?? "").trim()
    : false;

  const dirtyDevCodexHome = cfgBase
    ? (draft.codexHomeOverrideEnabled ? draft.codexHomeOverridePath.trim() : "") !== cfgBase.codexHome.trim()
    : false;

  const dirtyDevDiscord = cfgBase
    ? draft.adapterDiscordEnabled !== cfgBase.discordEnabled ||
      draft.adapterDiscordAppId.trim() !== cfgBase.discordAppId ||
      draft.adapterDiscordBotToken.trim().length > 0 ||
      !sameStringArray(normalizeGuildIds(draft.adapterDiscordGuildIds), cfgBase.discordGuildIds) ||
      draft.adapterDiscordDefaultStreamMode !== cfgBase.discordDefaultStreamMode
    : false;

  const dirtyDevWeb = cfgBase
    ? draft.webActiveProfileId !== cfgBase.webActiveProfileId ||
      !sameWebProfiles(draft.webProfiles, cfgBase.webProfiles) ||
      draft.webProfiles.some((p) => p.apiKey.trim().length > 0)
    : false;

  const dirtyDevSkills = cfgBase ? !sameStringArray(draft.skillsEnabled, cfgBase.skillsEnabled) : false;

  const dirtyDev =
    dirtyDevHostPort || dirtyDevDebug || dirtyDevInference || dirtyDevCodexHome || dirtyDevDiscord || dirtyDevWeb || dirtyDevSkills;

  const [saving, setSaving] = React.useState(false);

  const hostPortValid = ALLOWED_CONSOLE_HOSTS.has(draft.consoleHost.trim()) && isValidPort(draft.consolePort);
  const codexHomeValid = !draft.codexHomeOverrideEnabled || draft.codexHomeOverridePath.trim().length > 0;
  const openaiValid =
    draft.inferenceProfiles.length > 0 &&
    draft.inferenceProfiles.every((p) => p.name.trim().length > 0 && p.baseUrl.trim().length > 0 && p.modelId.trim().length > 0);
  const codexValid = draft.codexOAuthProfiles.every((p) => p.id.trim().length > 0 && p.name.trim().length > 0 && p.model.trim().length > 0);
  const inferenceValid = openaiValid && codexValid;

  const discordTokenOk = Boolean(cfgBase?.discordTokenConfigured) || draft.adapterDiscordBotToken.trim().length > 0;
  const discordAppIdOk = Boolean((cfgBase?.discordAppId ?? "").trim().length) || draft.adapterDiscordAppId.trim().length > 0;
  const discordValid = !draft.adapterDiscordEnabled || (discordTokenOk && discordAppIdOk);

  const webProviders = new Set(["tavily"]);
  const webIds = draft.webProfiles.map((p) => p.id);
  const webIdsUnique = new Set(webIds.map((x) => x.trim()).filter(Boolean)).size === draft.webProfiles.length;
  const webValid =
    draft.webProfiles.length > 0 &&
    webIdsUnique &&
    draft.webProfiles.every((p) => p.id.trim().length > 0 && p.name.trim().length > 0 && webProviders.has(p.provider)) &&
    draft.webProfiles.some((p) => p.id === draft.webActiveProfileId);

  const canSave =
    dirty &&
    !saving &&
    (!dirtyDev ||
      (!!cfgBase &&
        !cfgLoading &&
        (!dirtyDevHostPort || hostPortValid) &&
        (!dirtyDevInference || inferenceValid) &&
        (!dirtyDevCodexHome || codexHomeValid) &&
        (!dirtyDevDiscord || discordValid) &&
        (!dirtyDevWeb || webValid)));

  const discard = () => {
    discardDraft();
    setCfgError(null);
    setCfgSaved(null);
  };

  const save = async () => {
    if (!canSave) return;

    setSaving(true);
    setCfgError(null);
    setCfgSaved(null);

    try {
      let nextCfgBase = cfgBase;

      // 1) Save TOML startup config first (most likely to fail).
      if (dirtyDev) {
        if (!cfgBase) throw new Error("Config service unavailable.");

        const body = buildDevConfigPatch({
          draft,
          cfgBase,
          dirtyDevCodexHome,
          dirtyDevHostPort,
          hostPortValid,
          dirtyDevDebug,
          dirtyDevInference,
          inferenceValid,
          dirtyDevDiscord,
          discordValid,
          dirtyDevWeb,
          webValid,
          dirtyDevSkills
        });

        setCfgLoading(true);
        try {
          const j = await saveDevConfig(body);
          if (!j.ok) throw new Error(j.hint ?? j.error);

          const nextBase = applyDevConfigPatchToCfgBase(cfgBase, body);

          setCfgBase(nextBase);
          nextCfgBase = nextBase;

          // Clear secret inputs after a successful save so the form becomes clean.
          setDraft((d) => draftAfterDevSave(d, nextBase, dirtyDevInference, dirtyDevWeb));

          setCfgSaved(
            dirtyDevHostPort
              ? "Saved to eclia.config.local.toml. Restart required to apply host/port changes."
              : dirtyDevDiscord
                ? "Saved to eclia.config.local.toml. Restart required to apply adapter changes."
                : dirtyDevCodexHome
                  ? "Saved to eclia.config.local.toml. Restart required to apply Codex home changes."
                : "Saved to eclia.config.local.toml."
          );
        } finally {
          setCfgLoading(false);
        }
      }

      // 2) Commit UI/runtime changes.
      if (draft.textureDisabled !== state.settings.textureDisabled) {
        dispatch({ type: "settings/textureDisabled", enabled: draft.textureDisabled });
      }

      if (draft.sessionSyncEnabled !== state.settings.sessionSyncEnabled) {
        dispatch({ type: "settings/sessionSyncEnabled", enabled: draft.sessionSyncEnabled });
      }

      if (draft.displayPlainOutput !== Boolean(state.settings.displayPlainOutput ?? false)) {
        dispatch({ type: "settings/displayPlainOutput", enabled: draft.displayPlainOutput });
      }

      if (!sameStringArray(draft.enabledTools, state.settings.enabledTools)) {
        dispatch({ type: "settings/enabledTools", enabledTools: draft.enabledTools });
      }
      if (draft.transport !== state.transport) {
        dispatch({ type: "transport/set", transport: draft.transport });
      }
      {
        const effectiveModelForDispatch = nextCfgBase
          ? normalizeActiveModel(state.model, nextCfgBase.openaiCompatProfiles)
          : state.model;

        if (draft.model !== effectiveModelForDispatch) {
          dispatch({ type: "model/set", model: draft.model });
        }
      }

      if (draft.contextLimitEnabled !== state.settings.contextLimitEnabled) {
        dispatch({ type: "settings/contextLimitEnabled", enabled: draft.contextLimitEnabled });
      }

      const nextLimit = parseContextLimit(draft.contextTokenLimit);
      if (nextLimit !== state.settings.contextTokenLimit) {
        dispatch({ type: "settings/contextTokenLimit", value: nextLimit });
      }

      const nextWebTruncate = parseWebResultTruncateChars(draft.webResultTruncateChars);
      if (nextWebTruncate !== state.settings.webResultTruncateChars) {
        dispatch({ type: "settings/webResultTruncateChars", value: nextWebTruncate });
      }
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

  const webgl2Text =
    state.gpu.available === null ? "WebGL2: checking…" : state.gpu.available ? "WebGL2: available" : "WebGL2: unavailable";

  type SettingsSectionId = "general" | "appearance" | "tools" | "inference" | "adapters" | "skills";

  const sections: Array<{ id: SettingsSectionId; label: string }> = [
    { id: "general", label: "General" },
    { id: "appearance", label: "Appearance" },
    { id: "tools", label: "Tools" },
    { id: "inference", label: "Inference" },
    { id: "adapters", label: "Adapters" },
    { id: "skills", label: "Skills" }
  ];

  const [activeSection, setActiveSection] = React.useState<SettingsSectionId>("general");

  const inferenceController = useInferenceController({
    active: activeSection === "inference",
    draft,
    setDraft,
    cfgBase,
    setCfgBase,
    cfgError
  });

  return (
    <div className="settingsview motion-page">
      <div className="settings-head">
        <button className="btn icon" onClick={back} aria-label="Back" disabled={dirty || saving}>
          ←
        </button>

        <div className="settings-head-title">
          <EcliaLogo size="md" onClick={back} disabled={dirty || saving} />
          <div className="settings-title">Settings</div>
        </div>

        <div className="settings-head-actions">
          {dirty && (
            <div className="saveIndicator" role="status" aria-live="polite">
              <span className="saveDot" aria-hidden="true" />
              Unsaved changes
            </div>
          )}

          <button className="btn subtle" onClick={discard} disabled={!dirty || saving} aria-label="Discard changes">
            Discard
          </button>

          <button className="btn subtle" onClick={save} disabled={!canSave} aria-label="Save settings">
            {saving ? "Saving…" : "Save"}
          </button>

          <ThemeModeSwitch compact />
        </div>
      </div>

      <div className="settings-body">
        <aside className="settings-sidebar" aria-label="Settings navigation">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className="settings-nav-btn"
                data-active={activeSection === s.id ? "true" : "false"}
                aria-current={activeSection === s.id ? "page" : undefined}
                onClick={() => setActiveSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-content">
          <div key={activeSection} className="settings-section motion-item">
            {activeSection === "general" ? (
              <GeneralSection
                draft={draft}
                setDraft={setDraft}
                cfgLoading={cfgLoading}
                cfgBaseAvailable={!!cfgBase}
                cfgError={cfgError}
                cfgSaved={cfgSaved}
                dirtyDevHostPort={dirtyDevHostPort}
                hostPortValid={hostPortValid}
              />
            ) : null}

            {activeSection === "appearance" ? (
              <AppearanceSection draft={draft} setDraft={setDraft} webgl2Text={webgl2Text} />
            ) : null}

            {activeSection === "tools" ? (
              <ToolsSection
                draft={draft}
                setDraft={setDraft}
                cfgLoading={cfgLoading}
                cfgBaseAvailable={!!cfgBase}
                cfgWebProfiles={cfgBase?.webProfiles ?? []}
                dirtyDevWeb={dirtyDevWeb}
                webValid={webValid}
              />
            ) : null}

            {activeSection === "inference" ? (
              <InferenceSection
                draft={draft}
                setDraft={setDraft}
                transports={transports}
                cfgLoading={cfgLoading}
                cfgBaseAvailable={!!cfgBase}
                cfgCodexHome={cfgBase?.codexHome ?? ""}
                cfgOpenaiCompatProfiles={cfgBase?.openaiCompatProfiles ?? []}
                dirtyDevInference={dirtyDevInference}
                inferenceValid={inferenceValid}
                dirtyDevCodexHome={dirtyDevCodexHome}
                codexHomeValid={codexHomeValid}
                {...inferenceController}
              />
            ) : null}

            {activeSection === "adapters" ? (
              <AdaptersSection
                draft={draft}
                setDraft={setDraft}
                cfgLoading={cfgLoading}
                cfgBaseAvailable={!!cfgBase}
                discordAppIdConfigured={Boolean((cfgBase?.discordAppId ?? "").trim().length)}
                discordTokenConfigured={Boolean(cfgBase?.discordTokenConfigured)}
                dirtyDevDiscord={dirtyDevDiscord}
                discordValid={discordValid}
              />
            ) : null}

            {activeSection === "skills" ? (
              <SkillsSection
                draft={draft}
                setDraft={setDraft}
                cfgLoading={cfgLoading}
                cfgBaseAvailable={!!cfgBase}
                skillsAvailable={cfgBase?.skillsAvailable ?? []}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
