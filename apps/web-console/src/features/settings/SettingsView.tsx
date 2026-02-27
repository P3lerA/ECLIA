import React from "react";
import {
  CODEX_OAUTH_DEFAULT_MODEL,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_WEB_PROVIDER,
  WEB_PROVIDER_IDS
} from "@eclia/config/provider-defaults";
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
  parseMaxOutputTokens,
  parseTemperature,
  parseTopK,
  parseTopP,
  parseWebResultTruncateChars,
  portNumber,
  sameCodexOAuthProfiles,
  sameOpenAICompatProfiles,
  sameAnthropicProfiles,
  sameEmailListenerAccounts,
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
const DEFAULT_CODEX_MODEL = CODEX_OAUTH_DEFAULT_MODEL;

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

  const [cfgBase, setCfgBase] = React.useState<CfgBase | null>(null);

  // Load TOML config (best-effort).
  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setCfgLoading(true);
      setCfgError(null);

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
        model: cfgBase ? normalizeActiveModel(state.model, cfgBase.openaiCompatProfiles, cfgBase.anthropicProfiles) : state.model,
        contextTokenLimit: String(state.settings.contextTokenLimit ?? 20000),
        contextLimitEnabled: Boolean(state.settings.contextLimitEnabled ?? true),

        temperature: state.settings.temperature == null ? "" : String(state.settings.temperature),
        topP: state.settings.topP == null ? "" : String(state.settings.topP),
        topK: state.settings.topK == null ? "" : String(state.settings.topK),
        maxOutputTokens: state.settings.maxOutputTokens == null ? "" : String(state.settings.maxOutputTokens),

        webResultTruncateChars: String(state.settings.webResultTruncateChars ?? 4000),

        consoleHost: cfgBase?.host ?? prev?.consoleHost ?? "",
        consolePort: cfgBase ? String(cfgBase.port) : prev?.consolePort ?? "",
        userPreferredName: cfgBase?.userPreferredName ?? prev?.userPreferredName ?? "",
        assistantName: cfgBase?.assistantName ?? prev?.assistantName ?? "",

        webActiveProfileId: cfgBase?.webActiveProfileId ?? prev?.webActiveProfileId ?? DEFAULT_PROFILE_ID,
        webProfiles: cfgBase
          ? cfgBase.webProfiles.map((p) => ({
              id: p.id,
              name: p.name,
              provider: p.provider,
              projectId: p.projectId,
              apiKey: ""
            }))
          : prev?.webProfiles ?? [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, provider: DEFAULT_WEB_PROVIDER, apiKey: "", projectId: "" }],

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

        anthropicProfiles: cfgBase
          ? cfgBase.anthropicProfiles.map((p) => ({
              id: p.id,
              name: p.name,
              baseUrl: p.baseUrl,
              modelId: p.modelId,
              authHeader: p.authHeader,
              anthropicVersion: p.anthropicVersion,
              apiKey: ""
            }))
          : prev?.anthropicProfiles ?? [],


        codexOAuthProfiles: cfgBase
          ? cfgBase.codexOAuthProfiles.map((p) => ({ ...p })).slice(0, 1)
          : prev?.codexOAuthProfiles?.length
            ? [{ ...prev.codexOAuthProfiles[0], id: DEFAULT_PROFILE_ID }]
            : [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, model: DEFAULT_CODEX_MODEL }],

        inferenceSystemInstruction: cfgBase ? cfgBase.systemInstruction : prev?.inferenceSystemInstruction ?? "",

        codexHomeOverrideEnabled: cfgBase ? Boolean(cfgBase.codexHome.trim().length) : prev?.codexHomeOverrideEnabled ?? false,
        codexHomeOverridePath: cfgBase ? cfgBase.codexHome : prev?.codexHomeOverridePath ?? "",

        adapterDiscordEnabled: cfgBase?.discordEnabled ?? prev?.adapterDiscordEnabled ?? false,
        adapterDiscordAppId: cfgBase?.discordAppId ?? prev?.adapterDiscordAppId ?? "",
        adapterDiscordBotToken: "",
        adapterDiscordGuildWhitelist: cfgBase ? cfgBase.discordGuildWhitelist.join("\n") : prev?.adapterDiscordGuildWhitelist ?? "",
        adapterDiscordUserWhitelist: cfgBase ? cfgBase.discordUserWhitelist.join("\n") : prev?.adapterDiscordUserWhitelist ?? "",
        adapterDiscordForceGlobalCommands:
          cfgBase?.discordForceGlobalCommands ?? prev?.adapterDiscordForceGlobalCommands ?? false,
        adapterDiscordDefaultStreamMode: cfgBase?.discordDefaultStreamMode ?? prev?.adapterDiscordDefaultStreamMode ?? "final",

        adapterTelegramEnabled: cfgBase?.telegramEnabled ?? prev?.adapterTelegramEnabled ?? false,
        adapterTelegramBotToken: "",
        adapterTelegramUserWhitelist: cfgBase ? cfgBase.telegramUserWhitelist.join("\n") : prev?.adapterTelegramUserWhitelist ?? "",
        adapterTelegramGroupWhitelist: cfgBase ? cfgBase.telegramGroupWhitelist.join("\n") : prev?.adapterTelegramGroupWhitelist ?? "",

        pluginEmailListenerEnabled: cfgBase?.emailListenerEnabled ?? prev?.pluginEmailListenerEnabled ?? false,
        pluginEmailListenerTriagePrompt: cfgBase?.emailListenerTriagePrompt ?? prev?.pluginEmailListenerTriagePrompt ?? "",
        pluginEmailListenerAccounts: cfgBase
          ? cfgBase.emailListenerAccounts.map((a) => ({
              id: a.id,
              host: a.host,
              port: String(a.port),
              secure: a.secure,
              user: a.user,
              pass: "",
              mailbox: a.mailbox,
              criterion: a.criterion,
              model: a.model,
              notifyKind: a.notifyKind,
              notifyId: a.notifyId,
              startFrom: a.startFrom,
              maxBodyChars: String(a.maxBodyChars)
            }))
          : prev?.pluginEmailListenerAccounts ?? [],

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
      state.settings.temperature,
      state.settings.topP,
      state.settings.topK,
      state.settings.maxOutputTokens,
      state.settings.webResultTruncateChars,
      state.transport,
      state.model,
      cfgBase
    ]
  );

  const isDirtyDraft = React.useCallback(
    (d: SettingsDraft): boolean => {
      const effectiveStateModel = cfgBase ? normalizeActiveModel(state.model, cfgBase.openaiCompatProfiles, cfgBase.anthropicProfiles) : state.model;

      const dirtyUi =
        d.textureDisabled !== state.settings.textureDisabled ||
        d.sessionSyncEnabled !== state.settings.sessionSyncEnabled ||
        d.displayPlainOutput !== Boolean(state.settings.displayPlainOutput ?? false) ||
        !sameStringArray(d.enabledTools, state.settings.enabledTools) ||
        d.transport !== state.transport ||
        d.model !== effectiveStateModel ||
        d.contextLimitEnabled !== state.settings.contextLimitEnabled ||
        parseContextLimit(d.contextTokenLimit) !== state.settings.contextTokenLimit ||
        parseTemperature(d.temperature) !== state.settings.temperature ||
        parseTopP(d.topP) !== state.settings.topP ||
        parseTopK(d.topK) !== state.settings.topK ||
        parseMaxOutputTokens(d.maxOutputTokens) !== state.settings.maxOutputTokens ||
        parseWebResultTruncateChars(d.webResultTruncateChars) !== state.settings.webResultTruncateChars;

      const dirtyDevHostPort = cfgBase
        ? d.consoleHost.trim() !== cfgBase.host || portNumber(d.consolePort) !== cfgBase.port
        : false;

      const dirtyDevPersona = cfgBase
        ? d.userPreferredName.trim() !== cfgBase.userPreferredName || d.assistantName.trim() !== cfgBase.assistantName
        : false;

      const dirtyDevDebug = cfgBase ?
    d.debugCaptureUpstreamRequests !== cfgBase.debugCaptureUpstreamRequests ||
    d.debugParseAssistantOutput !== cfgBase.debugParseAssistantOutput
    : false;

      const dirtyDevInference = cfgBase
        ? !sameOpenAICompatProfiles(d.inferenceProfiles, cfgBase.openaiCompatProfiles) ||
          !sameAnthropicProfiles(d.anthropicProfiles, cfgBase.anthropicProfiles) ||
          !sameCodexOAuthProfiles(d.codexOAuthProfiles, cfgBase.codexOAuthProfiles) ||
          d.inferenceProfiles.some((p) => p.apiKey.trim().length > 0) ||
          d.anthropicProfiles.some((p) => p.apiKey.trim().length > 0) ||
          d.inferenceSystemInstruction.trim() !== (cfgBase.systemInstruction ?? "").trim()
        : false;

      const dirtyDevCodexHome = cfgBase
        ? (d.codexHomeOverrideEnabled ? d.codexHomeOverridePath.trim() : "") !== cfgBase.codexHome.trim()
        : false;

      const dirtyDevDiscord = cfgBase
        ? d.adapterDiscordEnabled !== cfgBase.discordEnabled ||
          d.adapterDiscordAppId.trim() !== cfgBase.discordAppId ||
          d.adapterDiscordBotToken.trim().length > 0 ||
          !sameStringArray(normalizeGuildIds(d.adapterDiscordGuildWhitelist), cfgBase.discordGuildWhitelist) ||
          !sameStringArray(normalizeGuildIds(d.adapterDiscordUserWhitelist), cfgBase.discordUserWhitelist) ||
          d.adapterDiscordForceGlobalCommands !== cfgBase.discordForceGlobalCommands ||
          d.adapterDiscordDefaultStreamMode !== cfgBase.discordDefaultStreamMode
        : false;

      const dirtyDevTelegram = cfgBase
        ? d.adapterTelegramEnabled !== cfgBase.telegramEnabled ||
          d.adapterTelegramBotToken.trim().length > 0 ||
          !sameStringArray(normalizeGuildIds(d.adapterTelegramUserWhitelist), cfgBase.telegramUserWhitelist) ||
          !sameStringArray(normalizeGuildIds(d.adapterTelegramGroupWhitelist), cfgBase.telegramGroupWhitelist)
        : false;

      const dirtyDevEmailListener = cfgBase
        ? d.pluginEmailListenerEnabled !== cfgBase.emailListenerEnabled ||
          d.pluginEmailListenerTriagePrompt !== cfgBase.emailListenerTriagePrompt ||
          !sameEmailListenerAccounts(d.pluginEmailListenerAccounts, cfgBase.emailListenerAccounts) ||
          d.pluginEmailListenerAccounts.some((a) => a.pass.trim().length > 0)
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
        dirtyDevPersona ||
        dirtyDevDebug ||
        dirtyDevInference ||
        dirtyDevCodexHome ||
        dirtyDevDiscord ||
        dirtyDevTelegram ||
        dirtyDevEmailListener ||
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
      state.settings.temperature,
      state.settings.topP,
      state.settings.topK,
      state.settings.maxOutputTokens,
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
      state.settings.temperature,
      state.settings.topP,
      state.settings.topK,
      state.settings.maxOutputTokens,
      state.settings.webResultTruncateChars,
      state.transport,
      state.model,
      cfgBase
    ]
  });

  const dirtyDevHostPort = cfgBase
    ? draft.consoleHost.trim() !== cfgBase.host || portNumber(draft.consolePort) !== cfgBase.port
    : false;

  const dirtyDevPersona = cfgBase
    ? draft.userPreferredName.trim() !== cfgBase.userPreferredName || draft.assistantName.trim() !== cfgBase.assistantName
    : false;

  const dirtyDevDebug = cfgBase ?
    draft.debugCaptureUpstreamRequests !== cfgBase.debugCaptureUpstreamRequests ||
    draft.debugParseAssistantOutput !== cfgBase.debugParseAssistantOutput
    : false;

  const dirtyDevInference = cfgBase
    ? !sameOpenAICompatProfiles(draft.inferenceProfiles, cfgBase.openaiCompatProfiles) ||
      !sameAnthropicProfiles(draft.anthropicProfiles, cfgBase.anthropicProfiles) ||
      !sameCodexOAuthProfiles(draft.codexOAuthProfiles, cfgBase.codexOAuthProfiles) ||
      draft.inferenceProfiles.some((p) => p.apiKey.trim().length > 0) ||
      draft.anthropicProfiles.some((p) => p.apiKey.trim().length > 0) ||
      draft.inferenceSystemInstruction.trim() !== (cfgBase.systemInstruction ?? "").trim()
    : false;

  const dirtyDevCodexHome = cfgBase
    ? (draft.codexHomeOverrideEnabled ? draft.codexHomeOverridePath.trim() : "") !== cfgBase.codexHome.trim()
    : false;

  const dirtyDevDiscord = cfgBase
    ? draft.adapterDiscordEnabled !== cfgBase.discordEnabled ||
      draft.adapterDiscordAppId.trim() !== cfgBase.discordAppId ||
      draft.adapterDiscordBotToken.trim().length > 0 ||
      !sameStringArray(normalizeGuildIds(draft.adapterDiscordGuildWhitelist), cfgBase.discordGuildWhitelist) ||
      !sameStringArray(normalizeGuildIds(draft.adapterDiscordUserWhitelist), cfgBase.discordUserWhitelist) ||
      draft.adapterDiscordForceGlobalCommands !== cfgBase.discordForceGlobalCommands ||
      draft.adapterDiscordDefaultStreamMode !== cfgBase.discordDefaultStreamMode
    : false;

  const dirtyDevTelegram = cfgBase
    ? draft.adapterTelegramEnabled !== cfgBase.telegramEnabled ||
      draft.adapterTelegramBotToken.trim().length > 0 ||
      !sameStringArray(normalizeGuildIds(draft.adapterTelegramUserWhitelist), cfgBase.telegramUserWhitelist) ||
      !sameStringArray(normalizeGuildIds(draft.adapterTelegramGroupWhitelist), cfgBase.telegramGroupWhitelist)
    : false;

  const dirtyDevEmailListener = cfgBase
    ? draft.pluginEmailListenerEnabled !== cfgBase.emailListenerEnabled ||
      draft.pluginEmailListenerTriagePrompt !== cfgBase.emailListenerTriagePrompt ||
      !sameEmailListenerAccounts(draft.pluginEmailListenerAccounts, cfgBase.emailListenerAccounts) ||
      draft.pluginEmailListenerAccounts.some((a) => a.pass.trim().length > 0)
    : false;

  const dirtyDevWeb = cfgBase
    ? draft.webActiveProfileId !== cfgBase.webActiveProfileId ||
      !sameWebProfiles(draft.webProfiles, cfgBase.webProfiles) ||
      draft.webProfiles.some((p) => p.apiKey.trim().length > 0)
    : false;

  const dirtyDevSkills = cfgBase ? !sameStringArray(draft.skillsEnabled, cfgBase.skillsEnabled) : false;

  const dirtyDev =
    dirtyDevHostPort ||
    dirtyDevPersona ||
    dirtyDevDebug ||
    dirtyDevInference ||
    dirtyDevCodexHome ||
    dirtyDevDiscord ||
    dirtyDevTelegram ||
    dirtyDevEmailListener ||
    dirtyDevWeb ||
    dirtyDevSkills;

  const [saving, setSaving] = React.useState(false);

  const hostPortValid = ALLOWED_CONSOLE_HOSTS.has(draft.consoleHost.trim()) && isValidPort(draft.consolePort);
  const codexHomeValid = !draft.codexHomeOverrideEnabled || draft.codexHomeOverridePath.trim().length > 0;
  const openaiValid =
    draft.inferenceProfiles.length > 0 &&
    draft.inferenceProfiles.every((p) => p.name.trim().length > 0 && p.baseUrl.trim().length > 0 && p.modelId.trim().length > 0);

  const anthropicValid =
    draft.anthropicProfiles.length > 0 &&
    draft.anthropicProfiles.every(
      (p) =>
        p.id.trim().length > 0 &&
        p.name.trim().length > 0 &&
        p.baseUrl.trim().length > 0 &&
        p.modelId.trim().length > 0 &&
        p.anthropicVersion.trim().length > 0
    );
  const codexValid = draft.codexOAuthProfiles.every((p) => p.id.trim().length > 0 && p.name.trim().length > 0 && p.model.trim().length > 0);
  const inferenceValid = openaiValid && anthropicValid && codexValid;

  const discordTokenOk = Boolean(cfgBase?.discordTokenConfigured) || draft.adapterDiscordBotToken.trim().length > 0;
  const discordAppIdOk = Boolean((cfgBase?.discordAppId ?? "").trim().length) || draft.adapterDiscordAppId.trim().length > 0;
  const discordValid = !draft.adapterDiscordEnabled || (discordTokenOk && discordAppIdOk);

  const telegramTokenOk = Boolean(cfgBase?.telegramTokenConfigured) || draft.adapterTelegramBotToken.trim().length > 0;
  const telegramWhitelistOk = normalizeGuildIds(draft.adapterTelegramUserWhitelist).length > 0;
  const telegramValid = !draft.adapterTelegramEnabled || (telegramTokenOk && telegramWhitelistOk);

  const emailPassConfiguredById = new Map<string, boolean>();
  for (const a of cfgBase?.emailListenerAccounts ?? []) emailPassConfiguredById.set(a.id, Boolean(a.passConfigured));

  const emailIds = draft.pluginEmailListenerAccounts.map((a) => a.id.trim());
  const emailIdsUnique = new Set(emailIds.filter(Boolean)).size === draft.pluginEmailListenerAccounts.length && emailIds.every(Boolean);
  const emailAccountsValid =
    draft.pluginEmailListenerAccounts.length === 0 ||
    (emailIdsUnique &&
      draft.pluginEmailListenerAccounts.every((a) => {
        const id = a.id.trim();
        const hostOk = a.host.trim().length > 0;
        const portOk = isValidPort(a.port);
        const userOk = a.user.trim().length > 0;
        const notifyOk = a.notifyId.trim().length > 0;

        const maxBodyOk =
          a.maxBodyChars.trim().length === 0 || (Number.isFinite(Number(a.maxBodyChars)) && Number(a.maxBodyChars) >= 0);

        const passConfigured = emailPassConfiguredById.get(id) === true;
        const passOk = !draft.pluginEmailListenerEnabled || passConfigured || a.pass.trim().length > 0;

        return hostOk && portOk && userOk && notifyOk && maxBodyOk && passOk;
      }));

  const emailListenerValid = emailAccountsValid && (!draft.pluginEmailListenerEnabled || draft.pluginEmailListenerAccounts.length > 0);

  const webProviders = new Set(WEB_PROVIDER_IDS);
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
        (!dirtyDevTelegram || telegramValid) &&
        (!dirtyDevEmailListener || emailListenerValid) &&
        (!dirtyDevWeb || webValid)));

  const discard = () => {
    discardDraft();
    setCfgError(null);
  };

  const save = async () => {
    if (!canSave) return;

    setSaving(true);
    setCfgError(null);

    try {
      let nextCfgBase = cfgBase;

      // 1) Save TOML startup config first (most likely to fail).
      if (dirtyDev) {
        if (!cfgBase) throw new Error("Config service unavailable.");

        const body = buildDevConfigPatch({
          draft,
          cfgBase,
          dirtyDevCodexHome,
          dirtyDevPersona,
          dirtyDevHostPort,
          hostPortValid,
          dirtyDevDebug,
          dirtyDevInference,
          inferenceValid,
          dirtyDevDiscord,
          discordValid,
          dirtyDevTelegram,
          telegramValid,
          dirtyDevEmailListener,
          emailListenerValid,
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
          ? normalizeActiveModel(state.model, nextCfgBase.openaiCompatProfiles, nextCfgBase.anthropicProfiles)
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

      const nextTemp = parseTemperature(draft.temperature);
      if (nextTemp !== state.settings.temperature) {
        dispatch({ type: "settings/temperature", value: nextTemp });
      }

      const nextTopP = parseTopP(draft.topP);
      if (nextTopP !== state.settings.topP) {
        dispatch({ type: "settings/topP", value: nextTopP });
      }

      const nextTopK = parseTopK(draft.topK);
      if (nextTopK !== state.settings.topK) {
        dispatch({ type: "settings/topK", value: nextTopK });
      }

      const nextMaxOut = parseMaxOutputTokens(draft.maxOutputTokens);
      if (nextMaxOut !== state.settings.maxOutputTokens) {
        dispatch({ type: "settings/maxOutputTokens", value: nextMaxOut });
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
                cfgAnthropicProfiles={cfgBase?.anthropicProfiles ?? []}
                dirtyDevInference={dirtyDevInference}
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

                telegramTokenConfigured={Boolean(cfgBase?.telegramTokenConfigured)}
                dirtyDevTelegram={dirtyDevTelegram}
                telegramValid={telegramValid}
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
