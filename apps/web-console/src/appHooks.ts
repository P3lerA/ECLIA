import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector, getState } from "./state/AppState";
import { apiFetch } from "./core/api/apiFetch";
import { AUTH_REQUIRED_EVENT } from "./core/api/gatewayAuth";
import { apiGetSession, apiGetSessionStatus, apiListSessions, toUiSession } from "./core/api/sessions";
import { makeId } from "./core/ids";
import { applyTheme, subscribeSystemThemeChange, writeStoredThemeMode } from "./theme/theme";
import { writeStoredPrefs } from "./persist/prefs";
import { populateConfigCache } from "./core/configCache";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AuthGate = {
  authRequired: boolean;
  authReady: boolean;
  authEpoch: number;
  onAuthed: () => void;
};

export function useAuthGate(): AuthGate {
  const navigate = useNavigate();
  const location = useLocation();

  const [authRequired, setAuthRequired] = React.useState(false);
  const [authReady, setAuthReady] = React.useState(false);
  const [authEpoch, setAuthEpoch] = React.useState(0);
  const authCheckedRef = React.useRef(false);

  // Startup auth probe: if the gateway requires a token, route to /connect.
  React.useEffect(() => {
    if (authCheckedRef.current) return;
    authCheckedRef.current = true;

    (async () => {
      try {
        const r = await apiFetch("/api/config", { method: "GET" });
        if (r.status === 401) {
          setAuthRequired(true);
          setAuthReady(false);
          if (location.pathname !== "/connect") navigate("/connect", { replace: true });
          return;
        }

        // Establish/refresh the scoped artifacts session cookie for this browser.
        // This keeps artifact URLs clean (no gateway token in query params) while
        // preserving bearer-token auth for programmatic clients.
        if (r.ok) {
          // Populate config cache for wireFormat lookups (computer use validation).
          try {
            const configJson = await r.clone().json();
            if (configJson?.config) populateConfigCache(configJson.config);
          } catch { /* best-effort */ }

          const s = await apiFetch("/api/auth/artifacts-session", { method: "POST" });
          if (s.status === 401) {
            setAuthRequired(true);
            setAuthReady(false);
            if (location.pathname !== "/connect") navigate("/connect", { replace: true });
            return;
          }
          // Even if the artifacts session endpoint returns a non-200 (unexpected),
          // we still consider the UI "authed" as long as /api/config is accessible.
          setAuthReady(true);
        }
      } catch {
        // Gateway offline: ignore.
      }
    })();
  }, [location.pathname, navigate]);

  // Any API call that receives 401 will broadcast AUTH_REQUIRED_EVENT.
  React.useEffect(() => {
    const onAuth = () => {
      setAuthRequired(true);
      setAuthReady(false);
      if (location.pathname !== "/connect") navigate("/connect", { replace: true });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuth);
  }, [location.pathname, navigate]);

  const onAuthed = React.useCallback(() => {
    setAuthRequired(false);
    setAuthReady(true);
    setAuthEpoch((v) => v + 1);
  }, []);

  return { authRequired, authReady, authEpoch, onAuthed };
}

// ---------------------------------------------------------------------------
// Session bootstrap
// ---------------------------------------------------------------------------

function safeDecodeSegment(seg: string): string | null {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

function getSessionIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/session\/([^/?#]+)/);
  return m?.[1] ? safeDecodeSegment(m[1]) : null;
}

export function useSessionBootstrap(auth: Pick<AuthGate, "authRequired" | "authReady" | "authEpoch">): void {
  const sessionSyncEnabled = useAppSelector((s) => s.settings.sessionSyncEnabled);
  const dispatch = useAppDispatch();
  const location = useLocation();

  // Prefer the session id from the URL on initial load (direct linking / refresh).
  const urlSessionId = React.useMemo(() => getSessionIdFromPath(location.pathname), [location.pathname]);

  const urlSessionIdRef = React.useRef<string | null>(urlSessionId);
  urlSessionIdRef.current = urlSessionId;

  const { authRequired, authReady, authEpoch } = auth;

  // Bootstrap sessions from the gateway (disk-backed).
  React.useEffect(() => {
    if (authRequired || !authReady) return;
    if (!sessionSyncEnabled) return;
    let cancelled = false;

    (async () => {
      try {
        const metas = await apiListSessions(200);

        if (cancelled) return;

        // If the gateway has no persisted sessions yet, keep whatever local draft the UI has.
        if (metas.length === 0) return;

        const persisted = metas.map((m) => toUiSession(m));
        const persistedIds = new Set(persisted.map((s) => s.id));

        // Read current state directly — avoids stale refs and eliminates full re-renders.
        const current = getState();
        const activeNow = current.activeSessionId;
        const localDrafts = current.sessions.filter(
          (s) => Boolean(s.localOnly) && (s.id === activeNow || Boolean(s.started))
        );
        const preservedDrafts = localDrafts.filter((s) => !persistedIds.has(s.id));

        const urlId = urlSessionIdRef.current;
        const desiredId = urlId ?? activeNow;

        const sessions = [...preservedDrafts, ...persisted];

        // If the user refreshed a /session/<id> URL, preserve that session as the preferred
        // selection even if the session list hasn't been hydrated yet.
        if (urlId && !sessions.some((s) => s.id === urlId)) {
          const now = Date.now();
          sessions.unshift({
            id: urlId,
            title: "New session",
            meta: "just now",
            createdAt: now,
            updatedAt: now,
            started: false
          });
        }

        dispatch({ type: "sessions/replace", sessions, activeSessionId: desiredId });
      } catch {
        // Gateway might be offline; keep local placeholder sessions.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dispatch, sessionSyncEnabled, authEpoch, authRequired, authReady]);

  // Load messages for the session in the URL on-demand.
  // If the gateway is actively processing a request, show the phase indicator and poll until done.
  React.useEffect(() => {
    if (authRequired || !authReady) return;
    if (!sessionSyncEnabled) return;
    let cancelled = false;
    const sid = urlSessionId;
    if (!sid) return;

    (async () => {
      try {
        const { session, messages, hasMore } = await apiGetSession(sid);
        if (cancelled) return;

        const ui = toUiSession(session);
        dispatch({ type: "session/update", sessionId: sid, patch: { ...ui, localOnly: false } });
        dispatch({ type: "messages/set", sessionId: sid, messages, hasMore });

        // Check if the gateway is still processing this session (refresh recovery).
        try {
          const status = await apiGetSessionStatus(sid);
          if (cancelled) return;

          if (status.active) {
            // Show a streaming placeholder with the current phase.
            dispatch({ type: "assistant/stream/start", sessionId: sid, messageId: makeId() });
            dispatch({ type: "session/setPhase", sessionId: sid, phase: status.phase });

            // Poll until the request completes.
            const poll = async () => {
              while (!cancelled) {
                await new Promise((r) => setTimeout(r, 2000));
                if (cancelled) break;
                try {
                  const s = await apiGetSessionStatus(sid);
                  if (cancelled) break;
                  if (!s.active) {
                    dispatch({ type: "session/setPhase", sessionId: sid, phase: null });
                    dispatch({ type: "assistant/stream/finalize", sessionId: sid });
                    try {
                      const fresh = await apiGetSession(sid);
                      if (!cancelled) {
                        dispatch({ type: "messages/set", sessionId: sid, messages: fresh.messages, hasMore: fresh.hasMore });
                      }
                    } catch { /* ignore */ }
                    break;
                  }
                  dispatch({ type: "session/setPhase", sessionId: sid, phase: s.phase });
                } catch {
                  dispatch({ type: "session/setPhase", sessionId: sid, phase: null });
                  dispatch({ type: "assistant/stream/finalize", sessionId: sid });
                  break;
                }
              }
            };
            poll();
          }
        } catch {
          // Status endpoint not available (older gateway) — no recovery.
        }
      } catch {
        // Ignore (session may be local-only, or gateway offline).
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [urlSessionId, dispatch, sessionSyncEnabled, authEpoch, authRequired, authReady]);
}

// ---------------------------------------------------------------------------
// Persist preferences + theme
// ---------------------------------------------------------------------------

export function usePersistPrefs(): void {
  const themeMode = useAppSelector((s) => s.themeMode);
  const settings = useAppSelector((s) => s.settings);
  const transport = useAppSelector((s) => s.transport);
  const model = useAppSelector((s) => s.model);

  // Theme: apply & persist (handles system changes in "system" mode).
  React.useEffect(() => {
    writeStoredThemeMode(themeMode);
    applyTheme(themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    if (themeMode !== "system") return;
    return subscribeSystemThemeChange(() => applyTheme("system"));
  }, [themeMode]);

  // Persist user preferences (stored locally in the browser).
  React.useEffect(() => {
    writeStoredPrefs({
      v: 1,
      textureDisabled: settings.textureDisabled,
      sessionSyncEnabled: settings.sessionSyncEnabled,
      displayPlainOutput: settings.displayPlainOutput,
      displayWorkProcess: settings.displayWorkProcess,
      webResultTruncateChars: settings.webResultTruncateChars,
      transport,
      model,
      contextLimitEnabled: settings.contextLimitEnabled,
      contextTokenLimit: settings.contextTokenLimit,
      temperature: settings.temperature ?? undefined,
      topP: settings.topP ?? undefined,
      topK: settings.topK ?? undefined,
      maxOutputTokens: settings.maxOutputTokens ?? undefined,
      toolAccessMode: settings.toolAccessMode,
      operationMode: settings.operationMode
    });
  }, [settings, transport, model]);
}
