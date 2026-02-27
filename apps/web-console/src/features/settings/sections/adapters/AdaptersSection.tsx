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

  telegramTokenConfigured: boolean;
  dirtyDevTelegram: boolean;
  telegramValid: boolean;
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
    discordValid,
    telegramTokenConfigured,
    dirtyDevTelegram,
    telegramValid
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
          iconName="simple-icons:discord"
          summary="I'm so sorry these logics are such a mess."
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
            </label>
          </div>

          <div className="grid2 stack-gap">
            <label className="field">
              <div className="field-label">Guild Whitelist</div>
              <textarea
                className="select"
                rows={3}
                value={draft.adapterDiscordGuildWhitelist}
                onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordGuildWhitelist: e.target.value }))}
                placeholder={"Enable Developer Mode in Discord to Copy Your Guild ID."}
                spellCheck={false}
                disabled={devDisabled}
              />
            </label>

            <label className="field">
              <div className="field-label">User Whitelist</div>
              <textarea
                className="select"
                rows={3}
                value={draft.adapterDiscordUserWhitelist}
                onChange={(e) => setDraft((d) => ({ ...d, adapterDiscordUserWhitelist: e.target.value }))}
                placeholder={"Enable Developer Mode in Discord to Copy Your User ID."}
                spellCheck={false}
                disabled={devDisabled}
              />
            </label>

            <div className="field-sub muted" style={{ gridColumn: "1 / -1" }}>
              Only Users/Guilds in these lists will be replied. Slashcommands are also registered only in whitelisted guilds when force global command registration is not enabled.
            </div>
          </div>

          <SettingsToggleRow
            className="stack-gap"
            title="Force global command registration"
            description={
              <>
                Not recommended, because registering global command can be stiky. However, this is the only option if you want to use slashcommand in DMs.
              </>
            }
            checked={draft.adapterDiscordForceGlobalCommands}
            onCheckedChange={(checked) => setDraft((d) => ({ ...d, adapterDiscordForceGlobalCommands: checked }))}
            ariaLabel="Force global command registration"
            disabled={devDisabled}
          />

          {dirtyDevDiscord && !discordValid ? (
            <div className="devNoteText muted">Discord adapter enabled but missing bot token or Application ID.</div>
          ) : null}
        </AdapterSettingItem>
      </div>

      <div>
        <AdapterSettingItem
          label="Telegram"
          iconName="simple-icons:telegram"
          summary="The Telegram Adapter. Still struggling with Markdown rendering."
          enabled={draft.adapterTelegramEnabled}
          onEnabledChange={(enabled) => setDraft((d) => ({ ...d, adapterTelegramEnabled: enabled }))}
          disabled={devDisabled}
        >
          <div className="grid2 stack-gap">
            <label className="field">
              <div className="field-label">Bot token (local)</div>
              <input
                className="select"
                type="password"
                value={draft.adapterTelegramBotToken}
                onChange={(e) => setDraft((d) => ({ ...d, adapterTelegramBotToken: e.target.value }))}
                placeholder={telegramTokenConfigured ? "configured (leave blank to keep)" : "not set"}
                spellCheck={false}
                disabled={devDisabled}
              />
            </label>
          </div>

          <div className="grid2 stack-gap">
            <label className="field">
              <div className="field-label">User Whitelist</div>
              <textarea
                className="select"
                rows={3}
                value={draft.adapterTelegramUserWhitelist}
                onChange={(e) => setDraft((d) => ({ ...d, adapterTelegramUserWhitelist: e.target.value }))}
                placeholder={"Find your user id using any dedicated bot."}
                spellCheck={false}
                disabled={devDisabled}
              />
            </label>

            <label className="field">
              <div className="field-label">Group Whitelist</div>
              <textarea
                className="select"
                rows={3}
                value={draft.adapterTelegramGroupWhitelist}
                onChange={(e) => setDraft((d) => ({ ...d, adapterTelegramGroupWhitelist: e.target.value }))}
                placeholder={"One per line. Should be negative."}
                spellCheck={false}
                disabled={devDisabled}
              />
            </label>

            <div className="field-sub muted" style={{ gridColumn: "1 / -1" }}>
              Only Users/Groups in these lists will be replied. 
            </div>
          </div>

          {dirtyDevTelegram && !telegramValid ? (
            <div className="devNoteText muted">Telegram adapter enabled but missing bot token or user whitelist.</div>
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
