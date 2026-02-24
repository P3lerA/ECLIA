import React from "react";
import type { SettingsDraft } from "../../settingsTypes";
import { SettingsAdvancedSection } from "../../components/SettingsAdvancedSection";
import { SettingsToggleRow } from "../../components/SettingsToggleRow";
import { AdapterSettingItem } from "./AdapterSettingItem";

export type AdaptersSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  cfgLoading: boolean;
  cfgBaseAvailable: boolean;

  discordAppIdConfigured: boolean;
  discordTokenConfigured: boolean;

  dirtyDevDiscord: boolean;
  discordValid: boolean;
};

export function AdaptersSection(props: AdaptersSectionProps) {
  const {
    draft,
    setDraft,
    cfgLoading,
    cfgBaseAvailable,
    discordAppIdConfigured,
    discordTokenConfigured,
    dirtyDevDiscord,
    discordValid
  } = props;

  const devDisabled = cfgLoading || !cfgBaseAvailable;

  return (
    <>
      {!cfgBaseAvailable ? (
        <div className="devNoteText muted">Config service unavailable. Start the backend (pnpm dev:all) to edit adapters.</div>
      ) : null}

      <div>
        <AdapterSettingItem
          label="Discord"
          summary="Enables the Discord bot adapter."
          enabled={draft.adapterDiscordEnabled}
          onEnabledChange={(enabled) => setDraft((d) => ({ ...d, adapterDiscordEnabled: enabled }))}
          disabled={devDisabled}
        >
          <div className="grid2 stack-gap">
            <label className="field">
              <div className="field-label">Application ID (client id)</div>
              <input
                className="select"
                value={draft.adapterDiscordAppId}
                onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordAppId: e.target.value }))}
                placeholder={discordAppIdConfigured ? "configured" : "not set"}
                spellCheck={false}
                disabled={devDisabled}
              />
              <div className="field-sub muted">
                Required for registering slash commands. Find it in the Discord Developer Portal (Application/Client ID).
              </div>
            </label>

            <label className="field">
              <div className="field-label">Bot token (local)</div>
              <input
                className="select"
                type="password"
                value={draft.adapterDiscordBotToken}
                onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordBotToken: e.target.value }))}
                placeholder={discordTokenConfigured ? "configured (leave blank to keep)" : "not set"}
                spellCheck={false}
                disabled={devDisabled}
              />
              <div className="field-sub muted">
                Stored in <code>eclia.config.local.toml</code>. Token is never shown after saving.
              </div>
            </label>
          </div>

          <div className="grid2 stack-gap">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="field-label">Guild IDs (optional)</div>
              <textarea
                className="select"
                rows={3}
                value={draft.adapterDiscordGuildIds}
                onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordGuildIds: e.target.value }))}
                placeholder={"123456789012345678\n987654321098765432"}
                spellCheck={false}
                disabled={devDisabled}
              />
              <div className="field-sub muted">
                If set, slash commands will be registered as <strong>guild</strong> commands for faster iteration. Leave blank for global registration.
              </div>
            </label>
          </div>

          {dirtyDevDiscord && !discordValid ? (
            <div className="devNoteText muted">Discord adapter enabled but missing bot token or Application ID.</div>
          ) : null}
        </AdapterSettingItem>
      </div>

      <SettingsAdvancedSection>
        <SettingsToggleRow
          className="stack-gap"
          title="Discord verbose default"
          description={
            <>
              When enabled, <code>/eclia</code> behaves as if <code>verbose=true</code> was set by default
              (equivalent to setting <code>ECLIA_DISCORD_DEFAULT_STREAM_MODE=full</code>). Saved to{" "}
              <code>eclia.config.local.toml</code>. Restart required.
            </>
          }
          checked={draft.adapterDiscordDefaultStreamMode === "full"}
          onCheckedChange={(checked) =>
            setDraft((d) => ({
              ...d,
              adapterDiscordDefaultStreamMode: checked ? "full" : "final"
            }))
          }
          ariaLabel="Discord verbose default"
          disabled={devDisabled}
        />
      </SettingsAdvancedSection>
    </>
  );
}
