import React from "react";
import type { SettingsDraft } from "../../settingsTypes";
import { SettingDisclosure } from "../../components/SettingDisclosure";
import { SettingsAdvancedSection } from "../../components/SettingsAdvancedSection";
import { ModelRouteSelect } from "../../components/ModelRouteSelect";
import { buildModelRouteOptions } from "../../settingsUtils";
import { AdapterSettingItem } from "../adapters/AdapterSettingItem";

export type PluginsSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  cfgLoading: boolean;
  cfgBaseAvailable: boolean;

  emailAccounts: Array<{ id: string; passConfigured: boolean }>;
  dirtyDevEmailListener: boolean;
  emailListenerValid: boolean;
};

function nextAccountId(existingIds: Set<string>, startIndex: number) {
  let n = Math.max(1, startIndex);
  while (existingIds.has(`account_${n}`)) n++;
  return `account_${n}`;
}

export function PluginsSection(props: PluginsSectionProps) {
  const { draft, setDraft, cfgLoading, cfgBaseAvailable, emailAccounts, dirtyDevEmailListener, emailListenerValid } = props;
  const devDisabled = cfgLoading || !cfgBaseAvailable;

  const passConfiguredById = React.useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of emailAccounts) m.set(a.id, Boolean(a.passConfigured));
    return m;
  }, [emailAccounts]);

  const modelOptions = React.useMemo(
    () => buildModelRouteOptions(draft.inferenceProfiles, draft.anthropicProfiles, draft.codexOAuthProfiles),
    [draft.inferenceProfiles, draft.anthropicProfiles, draft.codexOAuthProfiles]
  );

  const addAccount = () => {
    setDraft((d) => {
      const ids = new Set(d.pluginEmailListenerAccounts.map((a) => a.id.trim()).filter(Boolean));
      const id = nextAccountId(ids, d.pluginEmailListenerAccounts.length + 1);

      return {
        ...d,
        pluginEmailListenerAccounts: [
          ...d.pluginEmailListenerAccounts,
          {
            id,
            host: "",
            port: "993",
            secure: true,
            user: "",
            pass: "",
            mailbox: "INBOX",
            criterion: "",
            model: "",
            notifyKind: "discord",
            notifyId: "",
            startFrom: "now",
            maxBodyChars: "12000"
          }
        ]
      };
    });
  };

  const removeAccount = (idx: number) => {
    setDraft((d) => ({
      ...d,
      pluginEmailListenerAccounts: d.pluginEmailListenerAccounts.filter((_, i) => i !== idx)
    }));
  };

  const patchAccount = (idx: number, partial: Partial<SettingsDraft["pluginEmailListenerAccounts"][number]>) => {
    setDraft((d) => ({
      ...d,
      pluginEmailListenerAccounts: d.pluginEmailListenerAccounts.map((a, i) => (i === idx ? { ...a, ...partial } : a))
    }));
  };

  return (
    <>
      {!cfgBaseAvailable ? (
        <div className="devNoteText muted">Config service unavailable. Start the backend (pnpm dev:all) to edit plugins.</div>
      ) : null}

      <div className="settings-subtitle">Plugins</div>

      <div>
        <AdapterSettingItem
          label="Email listener"
          summary="IMAP IDLE triage daemon (ImapFlow) that can notify via the send tool."
          enabled={draft.pluginEmailListenerEnabled}
          onEnabledChange={(enabled) => setDraft((d) => ({ ...d, pluginEmailListenerEnabled: enabled }))}
          disabled={devDisabled}
        >
          <div className="field-sub muted">
            Config path: <code>plugins.listener.email</code>. IMAP passwords are secrets (prefer local overrides); this UI never reads
            them back.
          </div>

          <div className="stack-gap" style={{ marginTop: 12 }}>
            <div className="profileActions">
              <button type="button" className="btn" onClick={addAccount} disabled={devDisabled}>
                + Add account
              </button>
            </div>

            {dirtyDevEmailListener && !emailListenerValid ? (
              <div className="devNoteText" style={{ color: "var(--danger)" }}>
                Email listener settings are invalid. Please fill required fields (id/host/port/user/notify) and configure a
                password for enabled accounts.
              </div>
            ) : null}

            {draft.pluginEmailListenerAccounts.map((a, idx) => {
              const id = a.id.trim();
              const passConfigured = id ? passConfiguredById.get(id) === true : false;
              const notifyLabel = a.notifyKind === "telegram" ? "Chat ID" : "Channel ID";
              const modelValue = a.model.trim();

              return (
                <SettingDisclosure
                  key={`${idx}:${id || ""}`}
                  defaultOpen={draft.pluginEmailListenerAccounts.length === 1}
                  disabled={devDisabled}
                  iconName={a.notifyKind === "telegram" ? "simple-icons:telegram" : "simple-icons:discord"}
                  title={
                    <span>
                      {id ? id : `Account ${idx + 1}`} {a.host.trim() ? `— ${a.host.trim()}` : ""}
                    </span>
                  }
                  right={
                    <button
                      type="button"
                      className="btn"
                      onClick={() => removeAccount(idx)}
                      disabled={devDisabled}
                      aria-label={`Remove account ${id || idx + 1}`}
                    >
                      Remove
                    </button>
                  }
                >
                  <div className="grid2 stack-gap">
                    <label className="field">
                      <div className="field-label">ID</div>
                      <input
                        className="select"
                        value={a.id}
                        onChange={(e) => patchAccount(idx, { id: e.target.value })}
                        placeholder={`account_${idx + 1}`}
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field">
                      <div className="field-label">Mailbox</div>
                      <input
                        className="select"
                        value={a.mailbox}
                        onChange={(e) => patchAccount(idx, { mailbox: e.target.value })}
                        placeholder="INBOX"
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field">
                      <div className="field-label">Host</div>
                      <input
                        className="select"
                        value={a.host}
                        onChange={(e) => patchAccount(idx, { host: e.target.value })}
                        placeholder="imap.example.com"
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field">
                      <div className="field-label">Port</div>
                      <input
                        className="select"
                        type="number"
                        value={a.port}
                        onChange={(e) => patchAccount(idx, { port: e.target.value })}
                        placeholder="993"
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field" style={{ gridColumn: "1 / -1" }}>
                      <div className="field-label">
                        <input
                          type="checkbox"
                          checked={Boolean(a.secure)}
                          onChange={(e) => patchAccount(idx, { secure: e.target.checked })}
                          disabled={devDisabled}
                          style={{ marginRight: 8 }}
                        />
                        Use TLS (secure)
                      </div>
                    </label>

                    <label className="field">
                      <div className="field-label">User</div>
                      <input
                        className="select"
                        value={a.user}
                        onChange={(e) => patchAccount(idx, { user: e.target.value })}
                        placeholder="user@example.com"
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field">
                      <div className="field-label">Password (local)</div>
                      <input
                        className="select"
                        type="password"
                        value={a.pass}
                        onChange={(e) => patchAccount(idx, { pass: e.target.value })}
                        placeholder={passConfigured ? "configured (leave blank to keep)" : "not set"}
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field" style={{ gridColumn: "1 / -1" }}>
                      <div className="field-label">{"Criterion (fills {{criterion}} in the triage prompt)"}</div>
                      <input
                        className="select"
                        value={a.criterion}
                        onChange={(e) => patchAccount(idx, { criterion: e.target.value })}
                        placeholder="e.g. Notify me if the email is urgent or requires action within 24 hours."
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field">
                      <div className="field-label">Model route key (optional)</div>
                      <ModelRouteSelect
                        value={modelValue}
                        onChange={(nextModel) => patchAccount(idx, { model: nextModel })}
                        options={modelOptions}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field">
                      <div className="field-label">Notify platform</div>
                      <select
                        className="select"
                        value={a.notifyKind}
                        onChange={(e) => patchAccount(idx, { notifyKind: e.target.value as any })}
                        disabled={devDisabled}
                      >
                        <option value="discord">discord</option>
                        <option value="telegram">telegram</option>
                      </select>
                    </label>

                    <label className="field">
                      <div className="field-label">{notifyLabel}</div>
                      <input
                        className="select"
                        value={a.notifyId}
                        onChange={(e) => patchAccount(idx, { notifyId: e.target.value })}
                        placeholder={a.notifyKind === "telegram" ? "e.g. -1001234567890" : "e.g. 123456789012345678"}
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>

                    <label className="field">
                      <div className="field-label">Max body chars (optional)</div>
                      <input
                        className="select"
                        type="number"
                        value={a.maxBodyChars}
                        onChange={(e) => patchAccount(idx, { maxBodyChars: e.target.value })}
                        placeholder="12000"
                        spellCheck={false}
                        disabled={devDisabled}
                      />
                    </label>
                  </div>
                </SettingDisclosure>
                );
              })}
          </div>

          <div style={{ marginTop: 12 }}>
            <SettingsAdvancedSection>
              <label className="field" style={{ marginBottom: 0 }}>
                <div className="field-label">Triage prompt template</div>
                <textarea
                  className="select"
                  rows={12}
                  value={draft.pluginEmailListenerTriagePrompt}
                  onChange={(e) => setDraft((d) => ({ ...d, pluginEmailListenerTriagePrompt: e.target.value }))}
                  placeholder="(saved to plugins/listener/email/_triage.local.md)"
                  spellCheck={false}
                  disabled={devDisabled}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                />
                <div className="field-sub muted">
                  {"Available variables: {{criterion}}, {{mailbox}}, {{uid}}, {{message_id}}, {{from}}, {{to}}, {{subject}}, {{date}}, {{attachments}}, {{body}}. Loaded from and saved to plugins/listener/email/_triage.local.md."}
                </div>
              </label>
            </SettingsAdvancedSection>
          </div>
        </AdapterSettingItem>
      </div>
    </>
  );
}
