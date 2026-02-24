import { useAppDispatch, useAppState } from "../../state/AppState";
import { SegmentedSwitch, type SegmentedSwitchOption } from "../common/SegmentedSwitch";
import type { ThemeMode } from "../../theme/theme";

const OPTIONS: SegmentedSwitchOption<ThemeMode>[] = [
  { value: "light", label: "Light", title: "Theme: Light" },
  { value: "system", label: "System", title: "Theme: System" },
  { value: "dark", label: "Dark", title: "Theme: Dark" }
];

/**
 * Three-state theme selector (Light / System / Dark).
 * Used on the Chat page top-right.
 */
export function ThemeModeSwitch({ compact }: { compact?: boolean }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  return (
    <SegmentedSwitch
      compact={compact}
      ariaLabel="Theme"
      options={OPTIONS}
      value={state.themeMode}
      onChange={(mode) => dispatch({ type: "theme/setMode", mode })}
    />
  );
}
