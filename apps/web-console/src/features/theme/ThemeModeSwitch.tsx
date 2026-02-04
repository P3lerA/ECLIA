import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import type { ThemeMode } from "../../theme/theme";

const OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "system", label: "System" },
  { mode: "dark", label: "Dark" }
];

/**
 * Three-state theme selector (Light / System / Dark).
 * Used on the Chat page top-right.
 */
export function ThemeModeSwitch({ compact }: { compact?: boolean }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const active = state.themeMode;

  return (
    <div className={"themeSwitch" + (compact ? " compact" : "")} role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          className={"themeSwitch-btn" + (active === o.mode ? " active" : "")}
          aria-pressed={active === o.mode}
          onClick={() => dispatch({ type: "theme/setMode", mode: o.mode })}
          title={`Theme: ${o.label}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
