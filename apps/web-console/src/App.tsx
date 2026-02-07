import React from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { AppStateProvider, useAppDispatch, useAppState } from "./state/AppState";
import { LandingView } from "./features/landing/LandingView";
import { ChatView } from "./features/chat/ChatView";
import { MenuSheet } from "./features/menu/MenuSheet";
import { SettingsView } from "./features/settings/SettingsView";
import { PluginsView } from "./features/plugins/PluginsView";
import { BackgroundRoot } from "./features/background/BackgroundRoot";
import { applyTheme, subscribeSystemThemeChange, writeStoredThemeMode } from "./theme/theme";
import { writeStoredPrefs } from "./persist/prefs";
import { apiGetSession, apiListSessions, toUiSession } from "./core/api/sessions";

function getSessionIdFromPath(pathname: string): string | null {
  // /session/<session-id>
  const m = pathname.match(/^\/session\/([^/?#]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function SessionRoute({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { sessionId } = useParams();
  const location = useLocation();
  const state = useAppState();
  const dispatch = useAppDispatch();

  const dockFromLanding = Boolean((location.state as any)?.dockFromLanding);

  React.useEffect(() => {
    if (!sessionId) return;

    // Ensure the session exists in UI state early to avoid a "Session not found" flash
    // on hard-refresh / direct-links.
    const exists = state.sessions.some((s) => s.id === sessionId);
    if (!exists) {
      const now = Date.now();
      dispatch({
        type: "session/add",
        session: {
          id: sessionId,
          title: "New session",
          meta: "just now",
          createdAt: now,
          updatedAt: now,
          started: false
        }
      });
    }

    if (state.activeSessionId !== sessionId) {
      dispatch({ type: "session/select", sessionId });
    }
  }, [dispatch, sessionId, state.activeSessionId, state.sessions]);

  return <ChatView onOpenMenu={onOpenMenu} dockFromLanding={dockFromLanding} />;
}

function AppInner() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  // Keep a live ref so async bootstrap work doesn't capture a stale session id.
  const activeIdRef = React.useRef(state.activeSessionId);
  React.useEffect(() => {
    activeIdRef.current = state.activeSessionId;
  }, [state.activeSessionId]);

  // Prefer the session id from the URL on initial load (direct linking / refresh).
  const urlSessionId = React.useMemo(() => getSessionIdFromPath(location.pathname), [location.pathname]);

  // Theme: apply & persist (handles system changes in "system" mode).
  React.useEffect(() => {
    writeStoredThemeMode(state.themeMode);
    applyTheme(state.themeMode);
  }, [state.themeMode]);

  React.useEffect(() => {
    if (state.themeMode !== "system") return;
    return subscribeSystemThemeChange(() => applyTheme("system"));
  }, [state.themeMode]);

  // Persist user preferences (stored locally in the browser).
  React.useEffect(() => {
    writeStoredPrefs({
      v: 1,
      textureDisabled: state.settings.textureDisabled,
      transport: state.transport,
      model: state.model,
      contextLimitEnabled: state.settings.contextLimitEnabled,
      contextTokenLimit: state.settings.contextTokenLimit,
      execAccessMode: state.settings.execAccessMode,
      plugins: Object.fromEntries(state.plugins.map((p) => [p.id, p.enabled]))
    });
  }, [
    state.settings.textureDisabled,
    state.settings.contextLimitEnabled,
    state.settings.contextTokenLimit,
    state.settings.execAccessMode,
    state.transport,
    state.model,
    state.plugins
  ]);

  // Bootstrap sessions from the gateway (disk-backed).
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const metas = await apiListSessions(200);

        if (cancelled) return;

        const preferredId = urlSessionId ?? activeIdRef.current;

        // If the gateway has no persisted sessions yet, keep the local draft.
        // A session directory should be created only when the first message is sent.
        if (metas.length === 0) return;

        const sessions = metas.map((m) => ({ ...toUiSession(m), started: false }));

        // If the user refreshed a /session/<id> URL, preserve that session as the preferred
        // selection even if the session list hasn't been hydrated yet.
        if (urlSessionId && !sessions.some((s) => s.id === urlSessionId)) {
          const now = Date.now();
          sessions.unshift({
            id: urlSessionId,
            title: "New session",
            meta: "just now",
            createdAt: now,
            updatedAt: now,
            started: false,
          });
        }

        dispatch({ type: "sessions/replace", sessions, activeSessionId: preferredId });
      } catch {
        // Gateway might be offline; keep local placeholder sessions.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // Load messages for the active session on-demand.
  React.useEffect(() => {
    let cancelled = false;
    const sid = state.activeSessionId;
    if (!sid) return;

    (async () => {
      try {
        const { session, messages } = await apiGetSession(sid);
        if (cancelled) return;

        const ui = toUiSession(session);
        dispatch({ type: "session/update", sessionId: sid, patch: { ...ui, localOnly: false } });
        dispatch({ type: "messages/set", sessionId: sid, messages });
      } catch {
        // Ignore (session may be local-only, or gateway offline).
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.activeSessionId, dispatch]);

  const messages = state.messagesBySession[state.activeSessionId] ?? [];
  const active = state.sessions.find((s) => s.id === state.activeSessionId);
  const started = active?.started ?? messages.length > 0;
  const isLanding = !started;

  // Detect Landing → Chat transition to trigger one-shot docking animation.
  const prevIsLandingRef = React.useRef(isLanding);
  const dockFromLanding = prevIsLandingRef.current && !isLanding;
  React.useEffect(() => {
    prevIsLandingRef.current = isLanding;
  }, [isLanding]);

  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <div className="app">
      <BackgroundRoot />

      <div className="container">
        <Routes>
          <Route path="/settings" element={<SettingsView onBack={() => navigate("/")} />} />
          <Route path="/plugins" element={<PluginsView onBack={() => navigate("/")} />} />

          <Route
            path="/"
            element={
              isLanding ? (
                <LandingView onOpenMenu={() => setMenuOpen(true)} />
              ) : (
                <Navigate
                  to={`/session/${state.activeSessionId}`}
                  replace
                  state={{ dockFromLanding }}
                />
              )
            }
          />

          <Route path="/session/:sessionId" element={<SessionRoute onOpenMenu={() => setMenuOpen(true)} />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      <AppInner />
    </AppStateProvider>
  );
}
