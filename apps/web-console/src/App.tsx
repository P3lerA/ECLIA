import React from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppStateProvider, useAppState } from "./state/AppState";
import { LandingView } from "./features/landing/LandingView";
import { ChatView } from "./features/chat/ChatView";
import { MenuSheet } from "./features/menu/MenuSheet";
import { SettingsView } from "./features/settings/SettingsView";
import { PluginsView } from "./features/plugins/PluginsView";
import { BackgroundRoot } from "./features/background/BackgroundRoot";
import { applyTheme, subscribeSystemThemeChange, writeStoredThemeMode } from "./theme/theme";
import { writeStoredPrefs } from "./persist/prefs";

function AppInner() {
  const state = useAppState();
  const navigate = useNavigate();

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
      plugins: Object.fromEntries(state.plugins.map((p) => [p.id, p.enabled]))
    });
  }, [state.settings.textureDisabled, state.transport, state.model, state.plugins]);

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
                <ChatView onOpenMenu={() => setMenuOpen(true)} dockFromLanding={dockFromLanding} />
              )
            }
          />

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
