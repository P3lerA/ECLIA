import React from "react";
import type { CodexOAuthProfile, CodexOAuthStatus, CfgBase, SettingsDraft } from "../../settingsTypes";
import { clearCodexOAuth, fetchCodexStatus, pickNativeFolder, startCodexOAuthLogin } from "../../settingsInteractions";
import { anthropicProfileRoute, codexProfileRoute, newLocalId, openaiProfileRoute } from "../../settingsUtils";

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
  const { active, draft, setDraft, cfgBase, setCfgBase } = args;

  const [expandedOpenAICompatProfileId, setExpandedOpenAICompatProfileId] = React.useState<string | null>(null);
  const [expandedAnthropicProfileId, setExpandedAnthropicProfileId] = React.useState<string | null>(null);

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

  const autoStatusCheckedRef = React.useRef(false);

  // Best-effort: check status once when entering the inference section.
  React.useEffect(() => {
    if (!active) return;
    if (autoStatusCheckedRef.current) return;
    autoStatusCheckedRef.current = true;
    void refreshCodexStatus();
  }, [active, refreshCodexStatus]);

  // Keep provider/model route consistent with the available profile lists.
  React.useEffect(() => {
    if (!active) return;

    // Avoid "correcting" the provider selection before the config baseline
    // is hydrated. Otherwise, we can accidentally mark the page dirty and block
    // profile hydration (you'd need to hit Discard to recover).
    if (!cfgBase) return;

    const k = String(draft.model ?? "").trim();
    const isCodex = /^codex-oauth(?::|$)/.test(k);
    const isAnthropic =
      /^anthropic(?::|$)/.test(k) ||
      /^anthropic-compatible(?::|$)/.test(k) ||
      k === "anthropic" ||
      k === "anthropic-compatible";
    const isOpenAI = /^openai-compatible(?::|$)/.test(k) || k === "openai-compatible" || !k;

    if (isCodex) {
      const codexOk = codexProfiles.some((p) => codexProfileRoute(p.id) === k);
      if (codexOk) return;

      const next = codexProfiles.length
        ? codexProfileRoute(codexProfiles[0].id)
        : draft.inferenceProfiles.length
          ? openaiProfileRoute(draft.inferenceProfiles[0].id)
          : draft.anthropicProfiles.length
            ? anthropicProfileRoute(draft.anthropicProfiles[0].id)
            : k;

      if (k !== next) setDraft((d) => ({ ...d, model: next }));
      return;
    }

    if (isAnthropic) {
      const am = k.match(/^anthropic(?:-compatible)?:([\s\S]+)$/);
      const id = am ? String(am[1] ?? "").trim() : "";

      if (id && draft.anthropicProfiles.some((p) => p.id === id)) {
        const canon = anthropicProfileRoute(id);
        if (k !== canon) setDraft((d) => ({ ...d, model: canon }));
        return;
      }

      if (!id && (k === "anthropic" || k === "anthropic-compatible")) {
        if (draft.anthropicProfiles.length) {
          const next = anthropicProfileRoute(draft.anthropicProfiles[0].id);
          if (k !== next) setDraft((d) => ({ ...d, model: next }));
        }
        return;
      }

      const next = draft.anthropicProfiles.length
        ? anthropicProfileRoute(draft.anthropicProfiles[0].id)
        : draft.inferenceProfiles.length
          ? openaiProfileRoute(draft.inferenceProfiles[0].id)
          : codexProfiles.length
            ? codexProfileRoute(codexProfiles[0].id)
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
      } else if (draft.anthropicProfiles.length) {
        const next = anthropicProfileRoute(draft.anthropicProfiles[0].id);
        if (k !== next) setDraft((d) => ({ ...d, model: next }));
      }
    }
  }, [active, cfgBase, draft.inferenceProfiles, draft.anthropicProfiles, draft.model, codexProfiles, setDraft]);

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


  const patchAnthropicProfile = React.useCallback(
    (profileId: string, patch: Partial<SettingsDraft["anthropicProfiles"][number]>) => {
      setDraft((d) => ({
        ...d,
        anthropicProfiles: d.anthropicProfiles.map((p) => (p.id === profileId ? { ...p, ...patch } : p))
      }));
    },
    [setDraft]
  );

  const newAnthropicProfile = React.useCallback(() => {
    const id = newLocalId("p");

    setDraft((d) => {
      const base = d.anthropicProfiles[0];
      const next = {
        id,
        name: "New profile",
        baseUrl: base?.baseUrl ?? "https://api.anthropic.com",
        modelId: base?.modelId ?? "claude-3-5-sonnet-latest",
        authHeader: base?.authHeader ?? "x-api-key",
        anthropicVersion: base?.anthropicVersion ?? "2023-06-01",
        apiKey: ""
      };
      return { ...d, anthropicProfiles: [...d.anthropicProfiles, next] };
    });

    setExpandedAnthropicProfileId(id);
  }, [setDraft]);

  const deleteAnthropicProfile = React.useCallback(
    (profileId: string) => {
      setDraft((d) => {
        if (d.anthropicProfiles.length <= 1) return d;
        return {
          ...d,
          anthropicProfiles: d.anthropicProfiles.filter((p) => p.id !== profileId)
        };
      });

      setExpandedAnthropicProfileId((prev) => (prev === profileId ? null : prev));
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

    expandedAnthropicProfileId,
    setExpandedAnthropicProfileId,

    codexProfiles,
    patchOpenAICompatProfile,
    newOpenAICompatProfile,
    deleteOpenAICompatProfile,

    patchAnthropicProfile,
    newAnthropicProfile,
    deleteAnthropicProfile,

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
