import React from "react";
import type { TransportId } from "../../../../core/transport/TransportRegistry";
import { Collapsible } from "../../../common/Collapsible";
import { SettingDisclosure } from "../../components/SettingDisclosure";
import type { CodexOAuthProfile, CodexOAuthStatus, SettingsDraft } from "../../settingsTypes";
import { codexProfileRoute, openaiProfileRoute } from "../../settingsUtils";

export type InferenceSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  transports: TransportId[];

  cfgLoading: boolean;
  cfgBaseAvailable: boolean;
  cfgCodexHome: string;
  cfgOpenaiCompatProfiles: Array<{ id: string; apiKeyConfigured: boolean }>;

  expandedOpenAICompatProfileId: string | null;
  setExpandedOpenAICompatProfileId: React.Dispatch<React.SetStateAction<string | null>>;

  dirtyDevInference: boolean;
  inferenceValid: boolean;

  patchOpenAICompatProfile: (profileId: string, patch: Partial<SettingsDraft["inferenceProfiles"][number]>) => void;
  newOpenAICompatProfile: () => void;
  deleteOpenAICompatProfile: (profileId: string) => void;

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
    expandedOpenAICompatProfileId,
    setExpandedOpenAICompatProfileId,
    dirtyDevInference,
    inferenceValid,
    patchOpenAICompatProfile,
    newOpenAICompatProfile,
    deleteOpenAICompatProfile,
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
              disabled={!draft.inferenceProfiles.length && !codexProfiles.length}
            >
              {draft.inferenceProfiles.length || codexProfiles.length ? (
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
              right={isActivated ? <span className="activatedPill">Activated</span> : null}
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
                    placeholder="https://api.openai.com/v1"
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
                    placeholder="gpt-4o-mini"
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

        {dirtyDevInference && !inferenceValid ? <div className="devNoteText muted">Invalid provider profile settings.</div> : null}
      </div>

      <div className="card">
        <div className="card-title">Codex OAuth</div>

        <div className="devNoteText muted" style={{ marginBottom: 12 }}>
          Browser login is handled by <code>codex app-server</code> and the resulting session is stored by Codex itself. ECLIA only persists profile metadata (name/model) in{" "}
          <code>eclia.config.local.toml</code>.
        </div>

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
                        placeholder="Default"
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
                        placeholder="gpt-5.2-codex"
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

      <div className="card">
        <div className="card-title">Ollama</div>
        <div className="devNoteText muted">no configured profiles.</div>
      </div>

      <Collapsible title="Advanced" variant="section">
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
            Injected as the only <code>system</code> message (role=system) for all providers. Saved to <code>eclia.config.local.toml</code>.
          </div>
        </label>

        <div className="row">
          <div className="row-left">
            <div className="row-main">ECLIA_CODEX_HOME override</div>
            <div className="row-sub muted">
              Overrides <code>CODEX_HOME</code> for the spawned <code>codex app-server</code>. Leave off to use the default isolated directory.
            </div>
          </div>

          <input
            type="checkbox"
            checked={draft.codexHomeOverrideEnabled}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                codexHomeOverrideEnabled: e.target.checked,
                codexHomeOverridePath: e.target.checked ? d.codexHomeOverridePath : ""
              }))
            }
            aria-label="Override ECLIA_CODEX_HOME"
            disabled={devDisabled}
          />
        </div>

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
      </Collapsible>
    </>
  );
}
