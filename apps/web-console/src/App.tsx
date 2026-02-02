import React from "react";
import { AppStateProvider, useAppState } from "./state/AppState";
import { LandingView } from "./features/landing/LandingView";
import { ChatView } from "./features/chat/ChatView";
import { MenuSheet } from "./features/menu/MenuSheet";

function AppInner() {
  const state = useAppState();
  const messages = state.messagesBySession[state.activeSessionId] ?? [];
  const isLanding = messages.length === 0;

  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <div className="app">
      <div className="container">
        {isLanding ? (
          <LandingView onOpenMenu={() => setMenuOpen(true)} />
        ) : (
          <ChatView onOpenMenu={() => setMenuOpen(true)} />
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
