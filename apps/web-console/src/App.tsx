import React from "react";
import { AppStateProvider, useAppDispatch, useAppState } from "./state/AppState";
import { LandingView } from "./features/landing/LandingView";
import { ChatView } from "./features/chat/ChatView";
import { MenuSheet } from "./features/menu/MenuSheet";
import { SettingsView } from "./features/settings/SettingsView";
import { PluginsView } from "./features/plugins/PluginsView";
import { BackgroundRoot } from "./features/background/BackgroundRoot";
import { applyTheme, subscribeSystemThemeChange, writeStoredThemeMode } from "./theme/theme";

function AppInner() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  // Theme: apply & persist (handles system changes in "system" mode).
  React.useEffect(() => {
    writeStoredThemeMode(state.themeMode);
    applyTheme(state.themeMode);
  }, [state.themeMode]);

  React.useEffect(() => {
    if (state.themeMode !== "system") return;
    return subscribeSystemThemeChange(() => applyTheme("system"));
  }, [state.themeMode]);

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
        {state.page === "settings" ? (
          <SettingsView onBack={() => dispatch({ type: "nav/to", page: "console" })} />
        ) : state.page === "plugins" ? (
          <PluginsView onBack={() => dispatch({ type: "nav/to", page: "console" })} />
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