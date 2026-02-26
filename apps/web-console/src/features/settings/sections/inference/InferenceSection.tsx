import React from "react";
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_DEFAULT_VERSION,
  CODEX_OAUTH_DEFAULT_MODEL,
  DEFAULT_PROFILE_NAME,
  OPENAI_COMPAT_DEFAULT_BASE_URL,
  OPENAI_COMPAT_DEFAULT_MODEL
} from "@eclia/config/provider-defaults";
import type { TransportId } from "../../../../core/transport/TransportRegistry";
import { SettingsAdvancedSection } from "../../components/SettingsAdvancedSection";
import { SettingDisclosure } from "../../components/SettingDisclosure";
import { SettingsToggleRow } from "../../components/SettingsToggleRow";
import type { CodexOAuthProfile, CodexOAuthStatus, SettingsDraft } from "../../settingsTypes";
import { anthropicProfileRoute, codexProfileRoute, openaiProfileRoute } from "../../settingsUtils";

export type InferenceSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  transports: TransportId[];

  cfgLoading: boolean;
  cfgBaseAvailable: boolean;
  cfgCodexHome: string;
  cfgOpenaiCompatProfiles: Array<{ id: string; apiKeyConfigured: boolean }>;
  cfgAnthropicProfiles: Array<{ id: string; apiKeyConfigured: boolean }>;

  expandedOpenAICompatProfileId: string | null;
  setExpandedOpenAICompatProfileId: React.Dispatch<React.SetStateAction<string | null>>;

  expandedAnthropicProfileId: string | null;
  setExpandedAnthropicProfileId: React.Dispatch<React.SetStateAction<string | null>>;

  dirtyDevInference: boolean;

  patchOpenAICompatProfile: (profileId: string, patch: Partial<SettingsDraft["inferenceProfiles"][number]>) => void;
  newOpenAICompatProfile: () => void;
  deleteOpenAICompatProfile: (profileId: string) => void;

  patchAnthropicProfile: (profileId: string, patch: Partial<SettingsDraft["anthropicProfiles"][number]>) => void;
  newAnthropicProfile: () => void;
  deleteAnthropicProfile: (profileId: string) => void;

  codexProfiles: CodexOAuthProfile[];

  patchCodexProfile: (profileId: string, patch: Partial<CodexOAuthProfile>) => void;

  refreshCodexStatus: () => void;
  codexStatusLoading: boolean;
  codexStatus: CodexOAuthStatus | null;
  codexStatusError: string | null;
  codexStatusCheckedAt: number | null;

  startCodexBrowserLogin: (profileId: string) => void;
  clearCodexOAuthConfig: () => void;
  codexLoginBusyProfileId: string | null;
  codexLoginMsg: string | null;

  pickCodexHome: () => void;
  codexHomePickBusy: boolean;
  codexHomePickMsg: string | null;

  dirtyDevCodexHome: boolean;
  codexHomeValid: boolean;
};

export function InferenceSection(props: InferenceSectionProps) {
  const {
    draft,
    setDraft,
    transports,
    cfgLoading,
    cfgBaseAvailable,
    cfgCodexHome,
    cfgOpenaiCompatProfiles,
    cfgAnthropicProfiles,
    expandedOpenAICompatProfileId,
    setExpandedOpenAICompatProfileId,
    expandedAnthropicProfileId,
    setExpandedAnthropicProfileId,
    dirtyDevInference,
    patchOpenAICompatProfile,
    newOpenAICompatProfile,
    deleteOpenAICompatProfile,
    patchAnthropicProfile,
    newAnthropicProfile,
    deleteAnthropicProfile,
    codexProfiles,
    patchCodexProfile,
    refreshCodexStatus,
    codexStatusLoading,
    codexStatus,
    codexStatusError,
    codexStatusCheckedAt,
    startCodexBrowserLogin,
    clearCodexOAuthConfig,
    codexLoginBusyProfileId,
    codexLoginMsg,
    pickCodexHome,
    codexHomePickBusy,
    codexHomePickMsg,
    dirtyDevCodexHome,
    codexHomeValid
  } = props;

  const devDisabled = cfgLoading || !cfgBaseAvailable;

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

  return (
    <>
      <div className="card">
        <div className="card-title">Runtime</div>

        <div className="grid2">
          <label className="field">
            <div className="field-label">Transport</div>
            <select
              className="select"
              value={draft.transport}
              onChange={(e) => setDraft((d) => ({ ...d, transport: e.target.value as TransportId }))}
            >
              {transports.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <div className="field-label">Provider</div>
            <select
              className="select"
              value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              disabled={!draft.inferenceProfiles.length && !draft.anthropicProfiles.length && !codexProfiles.length}
            >
              {draft.inferenceProfiles.length || draft.anthropicProfiles.length || codexProfiles.length ? (
                <>
                  {draft.inferenceProfiles.length ? (
                    <optgroup label="OpenAI-compatible">
                      {draft.inferenceProfiles.map((p) => (
                        <option key={p.id} value={openaiProfileRoute(p.id)}>
                          {p.name.trim() || "Untitled"}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}

                  {draft.anthropicProfiles.length ? (
                    <optgroup label="Anthropic-compatible">
                      {draft.anthropicProfiles.map((p) => (
                        <option key={p.id} value={anthropicProfileRoute(p.id)}>
                          {p.name.trim() || "Untitled"}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}

                  {codexProfiles.length ? (
                    <optgroup label="Codex OAuth">
                      {codexProfiles.map((p) => (
                        <option key={p.id} value={codexProfileRoute(p.id)}>
                          {p.name.trim() || "Untitled"}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </>
              ) : (
                <option value={draft.model || "openai-compatible"}>{draft.model || "openai-compatible"}</option>
              )}
            </select>
          </label>

          <label className="field">
            <div className="field-label">Temperature</div>
            <input
              className="select"
              inputMode="decimal"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={draft.temperature}
              onChange={(e) => setDraft((d) => ({ ...d, temperature: e.target.value }))}
              placeholder="default"
            />
          </label>

          <label className="field">
            <div className="field-label">Top P</div>
            <input
              className="select"
              inputMode="decimal"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.topP}
              onChange={(e) => setDraft((d) => ({ ...d, topP: e.target.value }))}
              placeholder="default"
            />
          </label>

          <label className="field">
            <div className="field-label">Top K</div>
            <input
              className="select"
              inputMode="numeric"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={draft.topK}
              onChange={(e) => setDraft((d) => ({ ...d, topK: e.target.value }))}
              placeholder="default"
            />
            <div className="field-sub muted">Sent only when supported.</div>
          </label>

          <label className="field">
            <div className="field-label">Max output tokens</div>
            <input
              className="select"
              inputMode="numeric"
              type="number"
              min={1}
              max={200000}
              step={64}
              value={draft.maxOutputTokens}
              onChange={(e) => setDraft((d) => ({ ...d, maxOutputTokens: e.target.value }))}
              placeholder="default"
            />
            <div className="field-sub muted">Default is unlimited, Anthropic requests override with 2048.</div>
          </label>

          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <div className="field-label">Context limit (tokens)</div>

            <div className="contextLimitRow">
              <input
                className="select contextLimitInput"
                inputMode="numeric"
                type="number"
                min={256}
                max={1000000}
                step={256}
                value={draft.contextTokenLimit}
                onChange={(e) => setDraft((d) => ({ ...d, contextTokenLimit: e.target.value }))}
                disabled={!draft.contextLimitEnabled}
              />

              <label className="inlineToggle" title="Enable/disable sending a truncation budget to the gateway">
                <input
                  type="checkbox"
                  checked={draft.contextLimitEnabled}
                  onChange={(e) => setDraft((d) => ({ ...d, contextLimitEnabled: e.target.checked }))}
                />
                <span>Enabled</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-subtitle">Provider Settings</div>

      <div className="card">
        <div className="card-title">OpenAI-compatible profiles</div>

        {draft.inferenceProfiles.map((p) => {
          const isExpanded = expandedOpenAICompatProfileId === p.id;
          const isActivated = draft.model === openaiProfileRoute(p.id);
          const apiKeyConfigured = cfgOpenaiCompatProfiles.find((x) => x.id === p.id)?.apiKeyConfigured ?? false;
          const profileValid = p.name.trim().length > 0 && p.baseUrl.trim().length > 0 && p.modelId.trim().length > 0;

          return (
            <SettingDisclosure
              key={p.id}
              title={p.name.trim() || "Untitled"}
              open={isExpanded}
              onOpenChange={(next) => setExpandedOpenAICompatProfileId(next ? p.id : null)}
              right={
                isActivated ? (
                  <span className="activatedPill">Activated</span>
                ) : (
                  <span className="activatedPill activatedPillPlaceholder" aria-hidden="true">
                    Activated
                  </span>
                )
              }
              ariaLabel={`Provider profile: ${p.name.trim() || "Untitled"}`}
            >
              <div className="grid2">
                <label className="field">
                  <div className="field-label">Name</div>
                  <input
                    className="select"
                    value={p.name}
                    onChange={(e) => patchOpenAICompatProfile(p.id, { name: e.target.value })}
                    placeholder="Minimax"
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>

                <label className="field">
                  <div className="field-label">API key (local)</div>
                  <input
                    className="select"
                    type="password"
                    value={p.apiKey}
                    onChange={(e) => patchOpenAICompatProfile(p.id, { apiKey: e.target.value })}
                    placeholder={apiKeyConfigured ? "configured (leave blank to keep)" : "not set"}
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                  <div className="field-sub muted">
                    {apiKeyConfigured
                      ? "A key is already configured (not shown). Enter a new one to replace it."
                      : "No key detected. Set it here or in eclia.config.local.toml."}
                  </div>
                </label>

                <label className="field">
                  <div className="field-label">Base URL</div>
                  <input
                    className="select"
                    value={p.baseUrl}
                    onChange={(e) => patchOpenAICompatProfile(p.id, { baseUrl: e.target.value })}
                    placeholder={OPENAI_COMPAT_DEFAULT_BASE_URL}
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>

                <label className="field">
                  <div className="field-label">Model</div>
                  <input
                    className="select"
                    value={p.modelId}
                    onChange={(e) => patchOpenAICompatProfile(p.id, { modelId: e.target.value })}
                    placeholder={OPENAI_COMPAT_DEFAULT_MODEL}
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>
              </div>

              <div className="profileActions">
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => deleteOpenAICompatProfile(p.id)}
                  disabled={devDisabled || draft.inferenceProfiles.length <= 1}
                >
                  Delete profile
                </button>
              </div>

              {dirtyDevInference && !profileValid ? <div className="devNoteText muted">Missing required fields.</div> : null}
            </SettingDisclosure>
          );
        })}

        <div className="profileActions">
          <button type="button" className="btn subtle" onClick={newOpenAICompatProfile} disabled={devDisabled}>
            New profile
          </button>
        </div>

        {dirtyDevInference && !openaiValid ? <div className="devNoteText muted">Invalid OpenAI-compatible profile settings.</div> : null}
      </div>

      
      <div className="card">
        <div className="card-title">Anthropic-compatible profiles</div>

        {draft.anthropicProfiles.map((p) => {
          const isExpanded = expandedAnthropicProfileId === p.id;
          const isActivated = draft.model === anthropicProfileRoute(p.id);
          const apiKeyConfigured = cfgAnthropicProfiles.find((x) => x.id === p.id)?.apiKeyConfigured ?? false;
          const profileValid =
            p.id.trim().length > 0 &&
            p.name.trim().length > 0 &&
            p.baseUrl.trim().length > 0 &&
            p.modelId.trim().length > 0 &&
            p.anthropicVersion.trim().length > 0;

          return (
            <SettingDisclosure
              key={p.id}
              title={p.name.trim() || "Untitled"}
              open={isExpanded}
              onOpenChange={(next) => setExpandedAnthropicProfileId(next ? p.id : null)}
              right={
                isActivated ? (
                  <span className="activatedPill">Activated</span>
                ) : (
                  <span className="activatedPill activatedPillPlaceholder" aria-hidden="true">
                    Activated
                  </span>
                )
              }
              ariaLabel={`Provider profile: ${p.name.trim() || "Untitled"}`}
            >
              <div className="grid2">
                <label className="field">
                  <div className="field-label">Name</div>
                  <input
                    className="select"
                    value={p.name}
                    onChange={(e) => patchAnthropicProfile(p.id, { name: e.target.value })}
                    placeholder="Anthropic"
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>

                <label className="field">
                  <div className="field-label">API key (local)</div>
                  <input
                    className="select"
                    type="password"
                    value={p.apiKey}
                    onChange={(e) => patchAnthropicProfile(p.id, { apiKey: e.target.value })}
                    placeholder={apiKeyConfigured ? "configured (leave blank to keep)" : "not set"}
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                  <div className="field-sub muted">
                    {apiKeyConfigured
                      ? "A key is already configured (not shown). Enter a new one to replace it."
                      : "No key detected. Set it here or in eclia.config.local.toml."}
                  </div>
                </label>

                <label className="field">
                  <div className="field-label">Base URL</div>
                  <input
                    className="select"
                    value={p.baseUrl}
                    onChange={(e) => patchAnthropicProfile(p.id, { baseUrl: e.target.value })}
                    placeholder={ANTHROPIC_DEFAULT_BASE_URL}
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>

                <label className="field">
                  <div className="field-label">Model</div>
                  <input
                    className="select"
                    value={p.modelId}
                    onChange={(e) => patchAnthropicProfile(p.id, { modelId: e.target.value })}
                    placeholder={ANTHROPIC_DEFAULT_MODEL}
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>

                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="field-label">Anthropic version</div>
                  <input
                    className="select"
                    value={p.anthropicVersion}
                    onChange={(e) => patchAnthropicProfile(p.id, { anthropicVersion: e.target.value })}
                    placeholder={ANTHROPIC_DEFAULT_VERSION}
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>
              </div>

              <div className="profileActions">
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => deleteAnthropicProfile(p.id)}
                  disabled={devDisabled || draft.anthropicProfiles.length <= 1}
                >
                  Delete profile
                </button>
              </div>

              {dirtyDevInference && !profileValid ? <div className="devNoteText muted">Missing required fields.</div> : null}
            </SettingDisclosure>
          );
        })}

        <div className="profileActions">
          <button type="button" className="btn subtle" onClick={newAnthropicProfile} disabled={devDisabled}>
            New profile
          </button>
        </div>

        {dirtyDevInference && !anthropicValid ? <div className="devNoteText muted">Invalid Anthropic-compatible profile settings.</div> : null}
      </div>

      <div className="card">
        <div className="card-title">Codex OAuth</div>

        <div className="row" style={{ marginBottom: 12 }}>
          <div className="row-left">
            <div className="row-main">Availability</div>
            <div className="row-sub muted">
              Checks authentication via <code>account/read</code> and model availability via <code>model/list</code>.
            </div>
          </div>
          <button
            type="button"
            className="btn subtle"
            onClick={refreshCodexStatus}
            disabled={devDisabled || codexStatusLoading}
          >
            {codexStatusLoading ? "Checking…" : "Refresh status"}
          </button>
        </div>

        {codexProfiles.length
          ? (() => {
              const p = codexProfiles[0];
              const isBusy = codexLoginBusyProfileId === p.id;
              const isActivated = draft.model === codexProfileRoute(p.id);

              const availability = (() => {
                if (codexStatusLoading) return { label: "Checking…", detail: null as string | null };
                if (codexStatusError) return { label: "Unavailable", detail: codexStatusError };
                if (!codexStatus) return { label: "Unknown", detail: "Click “Refresh status” to run a check." };

                const requires = codexStatus.requires_openai_auth === true;
                const acctType = codexStatus.account?.type ? String(codexStatus.account.type) : "";
                const authed = !requires || !!acctType;
                if (!authed) {
                  return {
                    label: "Needs login",
                    detail: "Codex is not authenticated. Click “Login with browser”."
                  };
                }

                const models = codexStatus.models;
                if (Array.isArray(models) && models.length && !models.includes(p.model)) {
                  return {
                    label: "Model not available",
                    detail: `Model “${p.model}” was not found in Codex model catalog.`
                  };
                }

                const acct = codexStatus.account;
                const who = acct
                  ? `${acct.type}${acct.planType ? `/${acct.planType}` : ""}${acct.email ? ` (${acct.email})` : ""}`
                  : "authenticated";
                return { label: "Ready", detail: `Authenticated via ${who}.` };
              })();

              return (
                <>
                  <div className="grid2">
                    <label className="field">
                      <div className="field-label">Name</div>
                      <input
                        className="select"
                        value={p.name}
                        onChange={(e) => patchCodexProfile(p.id, { name: e.target.value })}
                        placeholder={DEFAULT_PROFILE_NAME}
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field">
                      <div className="field-label">Model</div>
                      <input
                        className="select"
                        value={p.model}
                        onChange={(e) => patchCodexProfile(p.id, { model: e.target.value })}
                        placeholder={CODEX_OAUTH_DEFAULT_MODEL}
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>
                  </div>

                  <div className="profileActions profileActionsRow">
                    <div className="profileActionsLeft">
                      <button
                        type="button"
                        className="btn subtle"
                        onClick={() => startCodexBrowserLogin(p.id)}
                        disabled={devDisabled || codexLoginBusyProfileId !== null}
                      >
                        {isBusy ? "Starting…" : "Login with browser"}
                      </button>

                      <button
                        type="button"
                        className="btn subtle"
                        onClick={clearCodexOAuthConfig}
                        disabled={devDisabled || codexLoginBusyProfileId !== null}
                      >
                        Sign out &amp; reset
                      </button>
                    </div>

                    {isActivated ? <span className="activatedPill">Activated</span> : null}
                  </div>

                  <div className="devNoteText muted">
                    Availability: {availability.label}
                    {availability.detail ? ` — ${availability.detail}` : ""}
                    {codexStatusCheckedAt ? ` · checked ${new Date(codexStatusCheckedAt).toLocaleTimeString()}` : ""}
                  </div>

                  {codexLoginMsg ? <div className="devNoteText muted">{codexLoginMsg}</div> : null}
                </>
              );
            })()
          : (
              <div className="devNoteText muted">No Codex OAuth configuration found.</div>
            )}
      </div>

      <SettingsAdvancedSection>
        <label className="field" style={{ marginBottom: 12 }}>
          <div className="field-label">Modify System Instruction</div>
          <textarea
            className="select"
            rows={6}
            value={draft.inferenceSystemInstruction}
            onChange={(e) => setDraft((d) => ({ ...d, inferenceSystemInstruction: e.target.value }))}
            placeholder="(optional)"
            spellCheck={false}
            disabled={devDisabled}
          />
          <div className="field-sub muted">
            Injected as system instruction. Saved to /_system.local.md.
          </div>
        </label>

        <SettingsToggleRow
          title="ECLIA_CODEX_HOME override"
          description={
            <>
              Overrides <code>CODEX_HOME</code> for the spawned <code>codex app-server</code>. Leave off to use the
              default isolated directory.
            </>
          }
          checked={draft.codexHomeOverrideEnabled}
          onCheckedChange={(checked) =>
            setDraft((d) => ({
              ...d,
              codexHomeOverrideEnabled: checked,
              codexHomeOverridePath: checked ? d.codexHomeOverridePath : ""
            }))
          }
          ariaLabel="Override ECLIA_CODEX_HOME"
          disabled={devDisabled}
        />

        {draft.codexHomeOverrideEnabled ? (
          <label className="field" style={{ marginTop: 10 }}>
            <div className="field-label">Directory</div>
            <div className="fieldInline">
              <input
                className="select"
                value={draft.codexHomeOverridePath}
                onChange={(e) => setDraft((d) => ({ ...d, codexHomeOverridePath: e.target.value }))}
                placeholder={cfgCodexHome.trim().length ? cfgCodexHome : "<repo>/.codex"}
                spellCheck={false}
                disabled={devDisabled}
              />

              <button type="button" className="btn subtle" onClick={pickCodexHome} disabled={devDisabled || codexHomePickBusy}>
                {codexHomePickBusy ? "Browsing…" : "Browse…"}
              </button>
            </div>
            <div className="field-sub muted">
              Saved to <code>eclia.config.local.toml</code>. Restart required.
            </div>
          </label>
        ) : null}

        {codexHomePickMsg ? <div className="devNoteText muted">{codexHomePickMsg}</div> : null}

        {dirtyDevCodexHome && !codexHomeValid ? <div className="devNoteText muted">Please select or enter a directory path.</div> : null}
      </SettingsAdvancedSection>
    </>
  );
}
