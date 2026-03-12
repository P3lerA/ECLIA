import React from "react";
import { useAppDispatch, useAppSelector } from "../../state/AppState";
import { cycleThemeMode, type ThemeMode } from "../../theme/theme";

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </svg>
  );
}

function EclipseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a7 7 0 1 0 10 10" />
    </svg>
  );
}

function iconFor(mode: ThemeMode): React.ReactNode {
  if (mode === "light") return <SunIcon />;
  if (mode === "dark") return <MoonIcon />;
  return <EclipseIcon />;
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
  const mode = useAppSelector((s) => s.themeMode);
  const dispatch = useAppDispatch();

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
