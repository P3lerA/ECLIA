import { useAppDispatch, useAppState } from "../../state/AppState";
import { cycleThemeMode, type ThemeMode } from "../../theme/theme";

function iconFor(mode: ThemeMode): string {
  // Keep it simple and widely supported (no custom icon set needed).
  if (mode === "light") return "☀";
  if (mode === "dark") return "☾";
  return "◐"; // system
}

function labelFor(mode: ThemeMode): string {
  if (mode === "light") return "Light";
  if (mode === "dark") return "Dark";
  return "System";
}

/**
 * Small circular theme button (cycles through: system → light → dark).
 * Used on the Landing page next to MENU.
 */
export function ThemeCycleButton({ className }: { className?: string }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const mode = state.themeMode;
  const next = cycleThemeMode(mode);

  return (
    <button
      className={className ?? "btn icon themeDot"}
      onClick={() => dispatch({ type: "theme/setMode", mode: next })}
      aria-label={`Theme: ${labelFor(mode)}. Click to switch to ${labelFor(next)}.`}
      title={`Theme: ${labelFor(mode)} (click to switch)`}
      type="button"
    >
      {iconFor(mode)}
    </button>
  );
}
