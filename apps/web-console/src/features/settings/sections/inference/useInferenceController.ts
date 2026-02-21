import React from "react";
import type { CodexOAuthProfile, CodexOAuthStatus, CfgBase, SettingsDraft } from "../../settingsTypes";
import { clearCodexOAuth, fetchCodexStatus, pickNativeFolder, startCodexOAuthLogin } from "../../settingsInteractions";
import { codexProfileRoute, newLocalId, openaiProfileRoute } from "../../settingsUtils";

export type UseInferenceControllerArgs = {
  /** True when the inference section is currently visible/active. */
  active: boolean;

  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  cfgBase: CfgBase | null;
  setCfgBase: React.Dispatch<React.SetStateAction<CfgBase | null>>;
  cfgError: string | null;
};

/**
 * Controller for the Inference section.
 *
 * This encapsulates: profile CRUD, Codex OAuth status + login flow, Codex home picker,
 * and the model-route guard that keeps the provider dropdown consistent.
 */
export function useInferenceController(args: UseInferenceControllerArgs) {
  const { active, draft, setDraft, cfgBase, setCfgBase, cfgError } = args;

  const [expandedOpenAICompatProfileId, setExpandedOpenAICompatProfileId] = React.useState<string | null>(null);

  const codexProfiles = draft.codexOAuthProfiles;

  const [codexLoginBusyProfileId, setCodexLoginBusyProfileId] = React.useState<string | null>(null);
  const [codexLoginMsg, setCodexLoginMsg] = React.useState<string | null>(null);

  const [codexStatusLoading, setCodexStatusLoading] = React.useState(false);
  const [codexStatus, setCodexStatus] = React.useState<CodexOAuthStatus | null>(null);
  const [codexStatusError, setCodexStatusError] = React.useState<string | null>(null);
  const [codexStatusCheckedAt, setCodexStatusCheckedAt] = React.useState<number | null>(null);

  const [codexHomePickBusy, setCodexHomePickBusy] = React.useState(false);
  const [codexHomePickMsg, setCodexHomePickMsg] = React.useState<string | null>(null);

  const pickCodexHome = React.useCallback(async () => {
    setCodexHomePickMsg(null);
    setCodexHomePickBusy(true);
    try {
      const p = await pickNativeFolder();
      if (!p) return;

      setDraft((d) => ({
        ...d,
        codexHomeOverrideEnabled: true,
        codexHomeOverridePath: p
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to select folder.";
      setCodexHomePickMsg(msg);
    } finally {
      setCodexHomePickBusy(false);
    }
  }, [setDraft]);

  const refreshCodexStatus = React.useCallback(async () => {
    setCodexStatusError(null);
    setCodexStatusLoading(true);
    try {
      const st = await fetchCodexStatus();
      setCodexStatus(st);
      setCodexStatusCheckedAt(Date.now());
    } catch (e) {
      setCodexStatus(null);
      const msg = e instanceof Error ? e.message : "Failed to check Codex status.";
      setCodexStatusError(msg);
    } finally {
      setCodexStatusLoading(false);
    }
  }, []);

  // Best-effort: check status once when entering the inference section.
  React.useEffect(() => {
    if (!active) return;
    if (!cfgBase) return;
    if (!codexProfiles.length) return;
    if (codexStatusLoading) return;
    if (codexStatusCheckedAt !== null) return;
    void refreshCodexStatus();
  }, [active, cfgBase, codexProfiles.length, codexStatusLoading, codexStatusCheckedAt, refreshCodexStatus]);

  React.useEffect(() => {
    // Avoid "correcting" the provider selection before the config baseline
    // is hydrated. Otherwise, we can accidentally mark the page dirty and block
    // OpenAI profile hydration (you'd need to hit Discard to recover).
    if (!cfgBase && !cfgError) return;

    const k = String(draft.model ?? "").trim();
    const isCodex = /^codex-oauth(?::|$)/.test(k);
    const isOpenAI = /^openai-compatible(?::|$)/.test(k) || k === "openai-compatible" || !k;

    if (isCodex) {
      const codexOk = codexProfiles.some((p) => codexProfileRoute(p.id) === k);
      if (codexOk) return;
      const next = codexProfiles.length
        ? codexProfileRoute(codexProfiles[0].id)
        : draft.inferenceProfiles.length
          ? openaiProfileRoute(draft.inferenceProfiles[0].id)
          : k;
      if (k !== next) setDraft((d) => ({ ...d, model: next }));
      return;
    }

    if (isOpenAI) {
      const openaiOk = draft.inferenceProfiles.some((p) => openaiProfileRoute(p.id) === k);
      if (openaiOk) return;

      if (draft.inferenceProfiles.length) {
        const next = openaiProfileRoute(draft.inferenceProfiles[0].id);
        if (k !== next) setDraft((d) => ({ ...d, model: next }));
      } else if (!cfgBase && codexProfiles.length) {
        // Config service unavailable: fall back to Codex so the dropdown isn't blank.
        const next = codexProfileRoute(codexProfiles[0].id);
        if (k !== next) setDraft((d) => ({ ...d, model: next }));
      }
    }
  }, [cfgBase, cfgError, draft.inferenceProfiles, draft.model, codexProfiles, setDraft]);

  const patchOpenAICompatProfile = React.useCallback(
    (profileId: string, patch: Partial<SettingsDraft["inferenceProfiles"][number]>) => {
      setDraft((d) => ({
        ...d,
        inferenceProfiles: d.inferenceProfiles.map((p) => (p.id === profileId ? { ...p, ...patch } : p))
      }));
    },
    [setDraft]
  );

  const newOpenAICompatProfile = React.useCallback(() => {
    const id = newLocalId("p");

    setDraft((d) => {
      const base = d.inferenceProfiles[0];
      const next = {
        id,
        name: "New profile",
        baseUrl: base?.baseUrl ?? "https://api.openai.com/v1",
        modelId: base?.modelId ?? "gpt-4o-mini",
        authHeader: base?.authHeader ?? "Authorization",
        apiKey: ""
      };
      return { ...d, inferenceProfiles: [...d.inferenceProfiles, next] };
    });

    setExpandedOpenAICompatProfileId(id);
  }, [setDraft]);

  const deleteOpenAICompatProfile = React.useCallback(
    (profileId: string) => {
      setDraft((d) => {
        if (d.inferenceProfiles.length <= 1) return d;
        return {
          ...d,
          inferenceProfiles: d.inferenceProfiles.filter((p) => p.id !== profileId)
        };
      });

      setExpandedOpenAICompatProfileId((prev) => (prev === profileId ? null : prev));
    },
    [setDraft]
  );

  const patchCodexProfile = React.useCallback(
    (profileId: string, patch: Partial<CodexOAuthProfile>) => {
      setDraft((d) => ({
        ...d,
        codexOAuthProfiles: d.codexOAuthProfiles.map((p) => (p.id === profileId ? { ...p, ...patch } : p))
      }));
    },
    [setDraft]
  );

  const startCodexBrowserLogin = React.useCallback(
    async (profileId: string) => {
      setCodexLoginMsg(null);
      setCodexLoginBusyProfileId(profileId);

      // Open a blank popup synchronously to avoid popup blockers.
      // NOTE: We intentionally do NOT pass noopener here because some browsers will
      // still open the tab but return `null`, which prevents us from closing it on error.
      // We manually null out opener after opening as a best-effort safety measure.
      const popup = window.open("about:blank", "_blank");
      try {
        if (popup) popup.opener = null;
      } catch {
        // ignore
      }
      try {
        if (popup && popup.document) {
          popup.document.title = "ECLIA – Codex login";
          popup.document.body.innerHTML =
            '<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; padding: 24px;">Starting Codex browser login…</div>';
        }
      } catch {
        // ignore
      }

      try {
        const profile = codexProfiles.find((p) => p.id === profileId);
        if (!profile) throw new Error("Missing Codex profile.");

        const url = await startCodexOAuthLogin(profile);
        if (url) {
          if (popup && !popup.closed) {
            popup.location.href = url;
          } else {
            window.open(url, "_blank", "noopener,noreferrer");
          }
          setCodexLoginMsg("Browser login started.");
        } else {
          // If we don't have an auth URL, the login flow can't proceed.
          setCodexLoginMsg("No authorization URL returned from server.");

          // Some browsers refuse window.close() outside a direct user gesture.
          // Prefer showing an error message instead of leaving a blank tab.
          if (popup && !popup.closed) {
            try {
              popup.document.title = "ECLIA – Codex login failed";
              popup.document.body.innerHTML =
                '<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; padding: 24px;">' +
                '<h2 style="margin: 0 0 10px 0;">Codex login failed</h2>' +
                '<p style="margin: 0 0 12px 0;">The server did not return an authorization URL.</p>' +
                '<p style="margin: 0; opacity: 0.8;">Close this window and return to Settings to see the error details.</p>' +
                "</div>";
            } catch {
              // ignore
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to start browser login.";
        setCodexLoginMsg(msg);

        // Some browsers refuse window.close() outside a direct user gesture.
        // Prefer showing an error message instead of leaving a blank tab.
        if (popup && !popup.closed) {
          try {
            popup.document.title = "ECLIA – Codex login failed";
            popup.document.body.innerHTML =
              '<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; padding: 24px;">' +
              '<h2 style="margin: 0 0 10px 0;">Codex login failed</h2>' +
              '<pre id="eclia-codex-login-error" style="white-space: pre-wrap; word-break: break-word; background: #111; color: #eee; padding: 12px; border-radius: 8px;">' +
              "</pre>" +
              '<p style="margin: 12px 0 0 0; opacity: 0.8;">Return to Settings to fix the issue and retry. You can also close this window.</p>' +
              "</div>";
            const el = popup.document.getElementById("eclia-codex-login-error");
            if (el) (el as any).textContent = msg;
          } catch {
            // ignore
          }
        }
      } finally {
        setCodexLoginBusyProfileId(null);
      }
    },
    [codexProfiles]
  );

  const clearCodexOAuthConfig = React.useCallback(async () => {
    setCodexLoginMsg(null);
    setCodexLoginBusyProfileId("default");
    try {
      await clearCodexOAuth();

      const reset: CodexOAuthProfile = { id: "default", name: "Default", model: "gpt-5.2-codex" };
      setDraft((d) => ({ ...d, codexOAuthProfiles: [reset] }));
      setCfgBase((b) => (b ? { ...b, codexOAuthProfiles: [reset] } : b));

      // Force a re-check so the UI reflects the new state quickly.
      setCodexStatus(null);
      setCodexStatusCheckedAt(null);
      void refreshCodexStatus();

      setCodexLoginMsg("Signed out and reset Codex OAuth configuration.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to clear Codex OAuth configuration.";
      setCodexLoginMsg(msg);
    } finally {
      setCodexLoginBusyProfileId(null);
    }
  }, [refreshCodexStatus, setCfgBase, setDraft]);

  return {
    expandedOpenAICompatProfileId,
    setExpandedOpenAICompatProfileId,

    codexProfiles,
    patchOpenAICompatProfile,
    newOpenAICompatProfile,
    deleteOpenAICompatProfile,

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
    codexHomePickMsg
  };
}
