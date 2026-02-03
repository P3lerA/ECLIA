import React from "react";
import { AppStateProvider, useAppDispatch, useAppState } from "./state/AppState";
import { LandingView } from "./features/landing/LandingView";
import { ChatView } from "./features/chat/ChatView";
import { MenuSheet } from "./features/menu/MenuSheet";
import { SettingsView } from "./features/settings/SettingsView";
import { BackgroundRoot } from "./features/background/BackgroundRoot";

function AppInner() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const messages = state.messagesBySession[state.activeSessionId] ?? [];
  const isLanding = messages.length === 0;

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
        {state.page === "settings" ? (
          <SettingsView onBack={() => dispatch({ type: "nav/to", page: "console" })} />
        ) : isLanding ? (
          <LandingView onOpenMenu={() => setMenuOpen(true)} />
        ) : (
          <ChatView onOpenMenu={() => setMenuOpen(true)} dockFromLanding={dockFromLanding} />
        )}
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
