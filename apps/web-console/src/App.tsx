import React from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { getState, useAppDispatch } from "./state/AppState";
import { LandingView } from "./features/landing/LandingView";
import { ChatView } from "./features/chat/ChatView";
import { MenuSheet } from "./features/menu/MenuSheet";
import { SettingsView } from "./features/settings/SettingsView";

import { SymphonyView } from "./features/symphony/SymphonyView";
import { BackgroundRoot } from "./features/background/BackgroundRoot";
import { GatewayTokenView } from "./features/auth/GatewayTokenView";
import { useAuthGate, useSessionBootstrap, usePersistPrefs } from "./appHooks";

function SessionRoute({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { sessionId } = useParams();
  const location = useLocation();
  const dispatch = useAppDispatch();

  const dockFromLanding = Boolean((location.state as any)?.dockFromLanding);

  React.useEffect(() => {
    if (!sessionId) return;

    // Read the latest state directly to avoid stale closures.
    // This effect is keyed only by `sessionId` — NOT `activeSessionId` — to
    // prevent snap-back when the user triggers "New session" while still on
    // `/session/:id` (the URL param hasn't changed yet, but activeSessionId has).
    const current = getState();

    const exists = current.sessions.some((s) => s.id === sessionId);
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

    if (current.activeSessionId !== sessionId) {
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

  const isSymphony = location.pathname.startsWith("/symphony");
  const containerWide =
    !isSymphony && location.pathname.startsWith("/settings");

  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <div className="app">
      <BackgroundRoot />

      <div className={isSymphony ? "container container-full" : containerWide ? "container container-wide" : "container"}>
        <Routes>
          <Route path="/connect" element={<GatewayTokenView onAuthed={auth.onAuthed} />} />

          <Route path="/settings" element={<SettingsView onBack={() => navigate("/")} />} />

          <Route path="/symphony" element={<SymphonyView />} />
          <Route path="/symphony/:opusId" element={<SymphonyView />} />

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
