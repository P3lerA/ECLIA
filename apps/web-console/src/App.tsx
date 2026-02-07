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

function safeDecodeSegment(seg: string): string | null {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

function getSessionIdFromPath(pathname: string): string | null {
  // /session/<session-id>
  const m = pathname.match(/^\/session\/([^/?#]+)/);
  return m?.[1] ? safeDecodeSegment(m[1]) : null;
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
    //
    // IMPORTANT: This effect is intentionally keyed only by `sessionId`.
    // When the user triggers "New session" while currently on `/session/:id`, we
    // will update the active session id *before* navigating away to `/`.
    // If we re-run on `activeSessionId` changes, we'd immediately "snap back" to
    // the old session because the URL param still points to it, effectively locking
    // the UI into a single session.
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
  }, [dispatch, sessionId]);

  return <ChatView onOpenMenu={onOpenMenu} dockFromLanding={dockFromLanding} />;
}

function AppInner() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const sessionsRef = React.useRef(state.sessions);
  React.useEffect(() => {
    sessionsRef.current = state.sessions;
  }, [state.sessions]);

  // Keep a live ref so async bootstrap work doesn't capture a stale session id.
  const activeIdRef = React.useRef(state.activeSessionId);
  React.useEffect(() => {
    activeIdRef.current = state.activeSessionId;
  }, [state.activeSessionId]);

  // Prefer the session id from the URL on initial load (direct linking / refresh).
  const urlSessionId = React.useMemo(() => getSessionIdFromPath(location.pathname), [location.pathname]);

  // Keep a live ref so async bootstrap doesn't accidentally pin the UI to the
  // session id that happened to be in the URL when the app first mounted.
  // (e.g. user clicks "New session" while the session list is still loading.)
  const urlSessionIdRef = React.useRef<string | null>(urlSessionId);
  React.useEffect(() => {
    urlSessionIdRef.current = urlSessionId;
  }, [urlSessionId]);

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

        // If the gateway has no persisted sessions yet, keep whatever local draft the UI has.
        // A session directory should be created only when the first message is sent.
        if (metas.length === 0) return;

        const persisted = metas.map((m) => ({ ...toUiSession(m), started: false }));
        const persistedIds = new Set(persisted.map((s) => s.id));

        // Preserve any local-only draft sessions that are either:
        //  - currently active (user may have clicked "New session" while the list is loading), or
        //  - already "started" (has local messages but may not be persisted yet if the gateway is offline).
        const activeNow = activeIdRef.current;
        const localDrafts = sessionsRef.current.filter(
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
  }, [dispatch]);

  // Load messages for the session in the URL on-demand.
  // (Navigation is router-driven; state should not "pull" the app into a session.)
  React.useEffect(() => {
    let cancelled = false;
    const sid = urlSessionId;
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
  }, [urlSessionId, dispatch]);

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
              <LandingView onOpenMenu={() => setMenuOpen(true)} />
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
