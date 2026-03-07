import React from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { useAppDispatch, useAppState } from "./state/AppState";
import { LandingView } from "./features/landing/LandingView";
import { ChatView } from "./features/chat/ChatView";
import { MenuSheet } from "./features/menu/MenuSheet";
import { SettingsView } from "./features/settings/SettingsView";
import { MemoryView } from "./features/memory/MemoryView";
import { SymphonyView } from "./features/symphony/SymphonyView";
import { BackgroundRoot } from "./features/background/BackgroundRoot";
import { GatewayTokenView } from "./features/auth/GatewayTokenView";
import { useAuthGate, useSessionBootstrap, usePersistPrefs } from "./appHooks";

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
  const navigate = useNavigate();
  const location = useLocation();

  const auth = useAuthGate();
  useSessionBootstrap(auth);
  usePersistPrefs();

  const containerWide =
    location.pathname.startsWith("/settings") || location.pathname.startsWith("/memory") || location.pathname.startsWith("/symphony");

  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <div className="app">
      <BackgroundRoot />

      <div className={containerWide ? "container container-wide" : "container"}>
        <Routes>
          <Route path="/connect" element={<GatewayTokenView onAuthed={auth.onAuthed} />} />

          <Route path="/settings" element={<SettingsView onBack={() => navigate("/")} />} />

          <Route path="/memory" element={<MemoryView onBack={() => navigate("/")} />} />

          <Route path="/symphony" element={<SymphonyView onBack={() => navigate("/")} />} />

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
  return <AppInner />;
}
