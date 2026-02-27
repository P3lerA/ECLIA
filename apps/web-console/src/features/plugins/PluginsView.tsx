import React from "react";

import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { EcliaLogo } from "../common/EcliaLogo";

import { fetchDevConfig, saveDevConfig } from "../settings/settingsInteractions";
import type { ConfigRequestBody, ConfigResponse } from "../settings/settingsTypes";
import { buildModelRouteOptions, isValidPort, sameEmailListenerAccounts, type ModelRouteOption } from "../settings/settingsUtils";
import { ModelRouteSelect } from "../settings/components/ModelRouteSelect";
import { SettingDisclosure } from "../settings/components/SettingDisclosure";
import { SettingsAdvancedSection } from "../settings/components/SettingsAdvancedSection";
import { AdapterSettingItem } from "../settings/sections/adapters/AdapterSettingItem";

type EmailListenerAccountBase = {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  mailbox: string;
  criterion: string;
  model: string;
  notifyKind: "discord" | "telegram";
  notifyId: string;
  startFrom: "now" | "all";
  maxBodyChars: number;
  passConfigured: boolean;
};

type EmailListenerDraftAccount = {
  id: string;
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string; // input-only
  mailbox: string;
  criterion: string;
  model: string;
  notifyKind: "discord" | "telegram";
  notifyId: string;
  startFrom: "now" | "all";
  maxBodyChars: string;
};

type EmailListenerBase = {
  enabled: boolean;
  triagePrompt: string;
  accounts: EmailListenerAccountBase[];
  modelOptions: ModelRouteOption[];
};

type EmailListenerDraft = {
  enabled: boolean;
  triagePrompt: string;
  accounts: EmailListenerDraftAccount[];
};

function asStr(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function readModelRouteOptions(cfg: any): ModelRouteOption[] {
  const openaiProfiles = Array.isArray((cfg as any)?.inference?.openai_compat?.profiles)
    ? (((cfg as any).inference.openai_compat.profiles as any[]) ?? []).map((p) => ({
        id: asStr(p?.id),
        name: asStr(p?.name)
      }))
    : [];

  const anthropicProfiles = Array.isArray((cfg as any)?.inference?.anthropic?.profiles)
    ? (((cfg as any).inference.anthropic.profiles as any[]) ?? []).map((p) => ({
        id: asStr(p?.id),
        name: asStr(p?.name)
      }))
    : [];

  const codexOAuthProfiles = Array.isArray((cfg as any)?.inference?.codex_oauth?.profiles)
    ? (((cfg as any).inference.codex_oauth.profiles as any[]) ?? []).map((p) => ({
        id: asStr(p?.id),
        name: asStr(p?.name)
      }))
    : [];

  return buildModelRouteOptions(openaiProfiles, anthropicProfiles, codexOAuthProfiles);
}

function readEmailListenerBase(cfg: any): EmailListenerBase {
  const email = (cfg as any)?.plugins?.listener?.email ?? {};
  const enabled = Boolean((email as any)?.enabled ?? false);
  const triagePrompt = typeof (email as any)?.triage_prompt === "string" ? String((email as any).triage_prompt) : "";
  const modelOptions = readModelRouteOptions(cfg);

  const accountsRaw = Array.isArray((email as any)?.accounts) ? ((email as any).accounts as any[]) : [];
  const accounts: EmailListenerAccountBase[] = accountsRaw.map((a) => {
    const notifyKindRaw = asStr(a?.notify?.kind).trim().toLowerCase();
    const notifyKind: "discord" | "telegram" = notifyKindRaw === "telegram" ? "telegram" : "discord";
    const notifyId =
      notifyKind === "telegram" ? asStr(a?.notify?.chat_id).trim() : asStr(a?.notify?.channel_id).trim();

    const startFrom: "now" = "now";

    const port = Number.isFinite(Number(a?.port)) ? Math.trunc(Number(a.port)) : 993;
    const maxBodyChars = Number.isFinite(Number(a?.max_body_chars)) ? Math.max(0, Math.trunc(Number(a.max_body_chars))) : 12_000;

    return {
      id: asStr(a?.id).trim(),
      host: asStr(a?.host).trim(),
      port,
      secure: Boolean(a?.secure ?? true),
      user: asStr(a?.user).trim(),
      mailbox: asStr(a?.mailbox).trim() || "INBOX",
      criterion: asStr(a?.criterion),
      model: asStr(a?.model).trim(),
      notifyKind,
      notifyId,
      startFrom,
      maxBodyChars,
      passConfigured: Boolean(a?.pass_configured ?? false)
    };
  });

  return { enabled, triagePrompt, accounts, modelOptions };
}

function baseToDraft(base: EmailListenerBase): EmailListenerDraft {
  return {
    enabled: base.enabled,
    triagePrompt: base.triagePrompt,
    accounts: base.accounts.map((a) => ({
      id: a.id,
      host: a.host,
      port: String(a.port || 993),
      secure: Boolean(a.secure),
      user: a.user,
      pass: "",
      mailbox: a.mailbox || "INBOX",
      criterion: a.criterion,
      model: a.model,
      notifyKind: a.notifyKind,
      notifyId: a.notifyId,
      startFrom: a.startFrom,
      maxBodyChars: String(a.maxBodyChars || 12_000)
    }))
  };
}

function nextAccountId(existingIds: Set<string>, startIndex: number) {
  let n = Math.max(1, startIndex);
  while (existingIds.has(`account_${n}`)) n++;
  return `account_${n}`;
}

export function PluginsView({ onBack }: { onBack: () => void }) {
  const [cfgLoading, setCfgLoading] = React.useState(true);
  const [cfgError, setCfgError] = React.useState<string | null>(null);
  const [base, setBase] = React.useState<EmailListenerBase | null>(null);
  const [draft, setDraft] = React.useState<EmailListenerDraft>({ enabled: false, triagePrompt: "", accounts: [] });
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setCfgLoading(true);
    setCfgError(null);
    try {
      const r = (await fetchDevConfig()) as ConfigResponse;
      if (!r?.ok) throw new Error((r as any)?.error || "Failed to load config.");
      const nextBase = readEmailListenerBase((r as any).config);
      setBase(nextBase);
      setDraft(baseToDraft(nextBase));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load config.";
      setCfgError(msg);
      setBase(null);
      setDraft({ enabled: false, triagePrompt: "", accounts: [] });
    } finally {
      setCfgLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const devDisabled = cfgLoading || !base;

  const passConfiguredById = React.useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of base?.accounts ?? []) m.set(a.id, Boolean(a.passConfigured));
    return m;
  }, [base]);

  const baseAccountsComparable = React.useMemo(
    () => (base?.accounts ?? []).map(({ passConfigured: _pc, ...rest }) => rest),
    [base]
  );

  const dirtyDevEmailListener = base
    ? draft.enabled !== base.enabled ||
      draft.triagePrompt !== base.triagePrompt ||
      !sameEmailListenerAccounts(draft.accounts as any, baseAccountsComparable as any) ||
      draft.accounts.some((a) => a.pass.trim().length > 0)
    : false;

  const emailListenerValid = React.useMemo(() => {
    if (!draft.enabled) return true;
    if (draft.accounts.length === 0) return false;

    const ids = new Set<string>();

    for (const a of draft.accounts) {
      const id = a.id.trim();
      const host = a.host.trim();
      const user = a.user.trim();
      const notifyId = a.notifyId.trim();

      if (!id || ids.has(id)) return false;
      ids.add(id);

      if (!host || !user || !notifyId) return false;
      if (!isValidPort(a.port)) return false;

      const passConfigured = id ? passConfiguredById.get(id) === true : false;
      const passOk = passConfigured || a.pass.trim().length > 0;
      if (!passOk) return false;

      const maxBody = a.maxBodyChars.trim();
      if (maxBody.length) {
        const n = Number(maxBody);
        if (!Number.isFinite(n) || n < 0) return false;
      }

      const mailbox = a.mailbox.trim();
      if (mailbox && mailbox.length > 200) return false;

      const model = a.model.trim();
      if (model.length > 200) return false;

      if (a.notifyKind !== "discord" && a.notifyKind !== "telegram") return false;
      if (a.startFrom !== "now") return false;
    }

    return true;
  }, [draft.enabled, draft.accounts, passConfiguredById]);

  const canSave = dirtyDevEmailListener && emailListenerValid && !saving;
  const modelOptions = base?.modelOptions ?? [];

  const discard = () => {
    if (!base || saving) return;
    setDraft(baseToDraft(base));
  };

  const save = async () => {
    if (!base) return;
    if (!canSave) return;

    setSaving(true);
    setCfgError(null);

    try {
      const body: ConfigRequestBody = {
        plugins: {
          listener: {
            email: {
              enabled: Boolean(draft.enabled),
              triage_prompt: draft.triagePrompt,
              accounts: draft.accounts.map((a) => {
                const portNum = Number(a.port);
                const port = Number.isFinite(portNum) ? Math.trunc(portNum) : 993;

                const maxBodyNum = Number(a.maxBodyChars);
                const max_body_chars = Number.isFinite(maxBodyNum) ? Math.max(0, Math.trunc(maxBodyNum)) : undefined;

                const notifyId = a.notifyId.trim();
                const notify = a.notifyKind === "telegram" ? { kind: "telegram", chat_id: notifyId } : { kind: "discord", channel_id: notifyId };

                return {
                  id: a.id.trim(),
                  host: a.host.trim(),
                  port,
                  secure: Boolean(a.secure),
                  user: a.user.trim(),
                  ...(a.pass.trim().length ? { pass: a.pass.trim() } : {}),
                  ...(a.mailbox.trim().length ? { mailbox: a.mailbox.trim() } : {}),
                  criterion: a.criterion,
                  ...(a.model.trim().length ? { model: a.model.trim() } : {}),
                  notify,
                  start_from: "now",
                  ...(typeof max_body_chars === "number" ? { max_body_chars } : {})
                };
              })
            }
          }
        }
      };

      const r = (await saveDevConfig(body as any)) as any;
      if (!r?.ok) throw new Error(r?.error || "Failed to save config.");

      // Re-load to reflect pass_configured flags.
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save config.";
      setCfgError(msg);
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    if (dirtyDevEmailListener || saving) return;
    onBack();
  };

  const addAccount = () => {
    setDraft((d) => {
      const ids = new Set(d.accounts.map((a) => a.id.trim()).filter(Boolean));
      const id = nextAccountId(ids, d.accounts.length + 1);

      return {
        ...d,
        accounts: [
          ...d.accounts,
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
    setDraft((d) => ({ ...d, accounts: d.accounts.filter((_, i) => i !== idx) }));
  };

  const patchAccount = (idx: number, partial: Partial<EmailListenerDraftAccount>) => {
    setDraft((d) => ({
      ...d,
      accounts: d.accounts.map((a, i) => (i === idx ? { ...a, ...partial } : a))
    }));
  };

  return (
    <div className="settingsview motion-page">
      <div className="settings-head">
        <button className="btn icon" onClick={back} aria-label="Back" disabled={dirtyDevEmailListener || saving}>
          ←
        </button>

        <div className="settings-head-title">
          <EcliaLogo size="md" onClick={back} disabled={dirtyDevEmailListener || saving} />
          <div className="settings-title">Plugins</div>
        </div>

        <div className="settings-head-actions">
          {dirtyDevEmailListener ? (
            <div className="saveIndicator" role="status" aria-live="polite">
              <span className="saveDot" aria-hidden="true" />
              Unsaved changes
            </div>
          ) : null}

          <button className="btn subtle" onClick={discard} disabled={!dirtyDevEmailListener || saving} aria-label="Discard changes">
            Discard
          </button>

          <button className="btn subtle" onClick={save} disabled={!canSave} aria-label="Save plugins">
            {saving ? "Saving…" : "Save"}
          </button>

          <ThemeModeSwitch compact />
        </div>
      </div>

      <div className="settings-body">
        <div className="settings-content" style={{ width: "100%" }}>
          <div className="settings-section motion-item">
            {!base ? (
              <div className="devNoteText muted">Config service unavailable. Start the backend (pnpm dev:all) to edit plugins.</div>
            ) : null}

            {cfgError ? (
              <div className="devNoteText" style={{ color: "var(--danger)" }}>
                {cfgError}
              </div>
            ) : null}

            <div className="settings-subtitle">listener-email</div>

            <div>
              <AdapterSettingItem
                label="listener-email"
                summary="Listen your mailbox and remind you when something hits your criterion."
                enabled={draft.enabled}
                onEnabledChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
                disabled={devDisabled}
              >

                <div className="stack-gap" style={{ marginTop: 12 }}>
                  <div className="profileActions" style={{ marginBottom: 6 }}>
                    <button type="button" className="btn" onClick={addAccount} disabled={devDisabled}>
                      + Add account
                    </button>
                    <button type="button" className="btn subtle" onClick={load} disabled={cfgLoading || saving} style={{ marginLeft: 8 }}>
                      Reload
                    </button>
                  </div>

                  {dirtyDevEmailListener && !emailListenerValid ? (
                    <div className="devNoteText" style={{ color: "var(--danger)" }}>
                      listener-email settings are invalid. Fill required fields (id/host/port/user/notify) and configure a
                      password for enabled accounts.
                    </div>
                  ) : null}

                  {draft.accounts.map((a, idx) => {
                    const id = a.id.trim();
                    const passConfigured = id ? passConfiguredById.get(id) === true : false;
                    const notifyLabel = a.notifyKind === "telegram" ? "Chat ID" : "Channel ID";
                    const modelValue = a.model.trim();

                    return (
                      <SettingDisclosure
                        key={`${idx}:${id || ""}`}
                        defaultOpen={draft.accounts.length === 1}
                        disabled={devDisabled}
                        iconName={a.notifyKind === "telegram" ? "simple-icons:telegram" : "simple-icons:discord"}
                        title={
                          <span>
                            {id ? id : `Account ${idx + 1}`} {a.user.trim() ? `— ${a.user.trim()}` : ""}
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
                            <div className="field-label">{"When shall ECLIA message you?"}</div>
                            <input
                              className="select"
                              value={a.criterion}
                              onChange={(e) => patchAccount(idx, { criterion: e.target.value })}
                              placeholder="Notify me if the email is urgent or requires action within 24 hours."
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
                        value={draft.triagePrompt}
                        onChange={(e) => setDraft((d) => ({ ...d, triagePrompt: e.target.value }))}
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
          </div>
        </div>
      </div>
    </div>
  );
}
