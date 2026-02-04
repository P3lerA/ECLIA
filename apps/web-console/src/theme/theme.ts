/**
 * Theme system (3 modes)
 * - light / dark / system
 * - Persist mode in localStorage
 * - Apply resolved theme via <html data-theme="..."> to drive CSS tokens
 *
 * Notes on edge cases:
 * - localStorage can throw (privacy modes / disabled storage) → guarded.
 * - matchMedia listeners differ across browsers (addEventListener vs addListener) → guarded.
 * - In system mode we subscribe to OS theme changes and re-apply.
 */

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "eclia-theme-mode";

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === "system" || v === "light" || v === "dark";
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemeMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function writeStoredThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? getSystemTheme() : mode;
}

export function applyTheme(mode: ThemeMode): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const resolved = resolveTheme(mode);

  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;

  // Helps native form controls pick correct default colors in supporting browsers.
  // CSS also sets color-scheme, but setting it here reduces "flash" on some systems.
  try {
    (root.style as any).colorScheme = resolved;
  } catch {
    // ignore
  }

  return resolved;
}

/**
 * Subscribe to system theme changes.
 * Only meaningful when mode === "system".
 */
export function subscribeSystemThemeChange(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  // Modern
  const modern = (mq as any).addEventListener && (mq as any).removeEventListener;
  if (modern) {
    const handler = () => onChange();
    (mq as any).addEventListener("change", handler);
    return () => (mq as any).removeEventListener("change", handler);
  }

  // Legacy Safari
  const legacy = (mq as any).addListener && (mq as any).removeListener;
  if (legacy) {
    const handler = () => onChange();
    (mq as any).addListener(handler);
    return () => (mq as any).removeListener(handler);
  }

  return () => {};
}

export function cycleThemeMode(mode: ThemeMode): ThemeMode {
  // Smallest mental model:
  // system → light → dark → system
  if (mode === "system") return "light";
  if (mode === "light") return "dark";
  return "system";
}

