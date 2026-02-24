import React from "react";
import { SettingDisclosure } from "../../components/SettingDisclosure";
import type { SettingsDraft } from "../../settingsTypes";
import { newLocalId } from "../../settingsUtils";

export type WebToolSettingsProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  cfgLoading: boolean;
  cfgBaseAvailable: boolean;
  cfgWebProfiles: Array<{ id: string; apiKeyConfigured: boolean }>;

  dirtyDevWeb: boolean;
  webValid: boolean;
};

const WEB_PROVIDERS: Array<{ id: string; label: string }> = [{ id: "tavily", label: "Tavily" }];

/**
 * Web tool settings.
 *
 * Note: This is dev-config backed (eclia.config.local.toml). API keys are write-only.
 */
export function WebToolSettings(props: WebToolSettingsProps) {
  const { draft, setDraft, cfgLoading, cfgBaseAvailable, cfgWebProfiles, dirtyDevWeb, webValid } = props;

  const devDisabled = cfgLoading || !cfgBaseAvailable;

  const [expandedProfileId, setExpandedProfileId] = React.useState<string | null>(null);

  const patchProfile = React.useCallback(
    (profileId: string, patch: Partial<SettingsDraft["webProfiles"][number]>) => {
      setDraft((d) => ({
        ...d,
        webProfiles: d.webProfiles.map((p) => (p.id === profileId ? { ...p, ...patch } : p))
      }));
    },
    [setDraft]
  );

  const newProfile = React.useCallback(() => {
    const id = newLocalId("web");

    setDraft((d) => {
      const base = d.webProfiles[0];
      const next = {
        id,
        name: "New profile",
        provider: base?.provider ?? "tavily",
        apiKey: "",
        projectId: base?.projectId ?? ""
      };
      return {
        ...d,
        webProfiles: [...d.webProfiles, next]
      };
    });

    setExpandedProfileId(id);
  }, [setDraft]);

  const deleteProfile = React.useCallback(
    (profileId: string) => {
      setDraft((d) => {
        if (d.webProfiles.length <= 1) return d;
        const nextProfiles = d.webProfiles.filter((p) => p.id !== profileId);
        const nextActive = nextProfiles.some((p) => p.id === d.webActiveProfileId)
          ? d.webActiveProfileId
          : nextProfiles[0]?.id ?? "";
        return {
          ...d,
          webProfiles: nextProfiles,
          webActiveProfileId: nextActive
        };
      });

      setExpandedProfileId((prev) => (prev === profileId ? null : prev));
    },
    [setDraft]
  );

  return (
    <>
        <div className="grid2">
          <label className="field">
            <div className="field-label">Active profile</div>
            <select
              className="select"
              value={draft.webActiveProfileId}
              onChange={(e) => setDraft((d) => ({ ...d, webActiveProfileId: e.target.value }))}
              disabled={devDisabled || !draft.webProfiles.length}
            >
              {draft.webProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name.trim() || "Untitled"}
                </option>
              ))}
            </select>
            <div className="field-sub muted">
              This profile is used by the gateway when executing the <span className="k">web</span> tool.
            </div>
          </label>

          <label className="field">
            <div className="field-label">Preview truncate (chars)</div>
            <input
              className="select"
              inputMode="numeric"
              type="number"
              min={200}
              max={200000}
              step={100}
              value={draft.webResultTruncateChars}
              onChange={(e) => setDraft((d) => ({ ...d, webResultTruncateChars: e.target.value }))}
            />
            <div className="field-sub muted">UI-only: limits how much content is shown per web result item.</div>
          </label>
        </div>


        <div className="card-title stack-gap">Web provider profiles</div>

        {draft.webProfiles.map((p) => {
          const isExpanded = expandedProfileId === p.id;
          const isActivated = draft.webActiveProfileId === p.id;
          const apiKeyConfigured = cfgWebProfiles.find((x) => x.id === p.id)?.apiKeyConfigured ?? false;
          const providerLabel = WEB_PROVIDERS.find((x) => x.id === p.provider)?.label ?? p.provider;

          return (
            <SettingDisclosure
              key={p.id}
              title={p.name.trim() || "Untitled"}
              open={isExpanded}
              onOpenChange={(next) => setExpandedProfileId(next ? p.id : null)}
              right={isActivated ? <span className="activatedPill">Activated</span> : null}
              ariaLabel={`Web provider profile: ${p.name.trim() || "Untitled"}`}
            >
              <div className="grid2">
                <label className="field">
                  <div className="field-label">Name</div>
                  <input
                    className="select"
                    value={p.name}
                    onChange={(e) => patchProfile(p.id, { name: e.target.value })}
                    placeholder="Default"
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                </label>

                <label className="field">
                  <div className="field-label">Provider</div>
                  <select
                    className="select"
                    value={p.provider}
                    onChange={(e) => patchProfile(p.id, { provider: e.target.value })}
                    disabled={devDisabled}
                    title={providerLabel}
                  >
                    {WEB_PROVIDERS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <div className="field-label">API key (local)</div>
                  <input
                    className="select"
                    type="password"
                    value={p.apiKey}
                    onChange={(e) => patchProfile(p.id, { apiKey: e.target.value })}
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
                  <div className="field-label">Project</div>
                  <input
                    className="select"
                    value={p.projectId}
                    onChange={(e) => patchProfile(p.id, { projectId: e.target.value })}
                    placeholder="(optional)"
                    spellCheck={false}
                    disabled={devDisabled}
                  />
                  <div className="field-sub muted">For Tavily this maps to the X-Project-ID header (optional).</div>
                </label>

                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="profileActions profileActionsRow">
                    <div className="profileActionsLeft">
                      {!isActivated ? (
                        <button
                          className="btn subtle"
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, webActiveProfileId: p.id }))}
                          disabled={devDisabled}
                        >
                          Activate
                        </button>
                      ) : null}
                    </div>

                    <button
                      className="btn subtle"
                      type="button"
                      onClick={() => deleteProfile(p.id)}
                      disabled={devDisabled || draft.webProfiles.length <= 1}
                      title={draft.webProfiles.length <= 1 ? "At least one profile is required." : "Delete this profile"}
                    >
                      Delete profile
                    </button>
                  </div>
                </div>
              </div>
            </SettingDisclosure>
          );
        })}

        <div className="profileActions">
          <button className="btn subtle" type="button" onClick={newProfile} disabled={devDisabled}>
            New profile
          </button>
        </div>

        {dirtyDevWeb && !webValid ? <div className="devNoteText muted">Invalid web profile settings.</div> : null}
        {devDisabled ? <div className="devNoteText muted">Config service unavailable.</div> : null}
    </>
  );
}
