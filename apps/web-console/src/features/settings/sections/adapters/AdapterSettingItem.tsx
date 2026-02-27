import React from "react";
import { SettingDisclosure } from "../../components/SettingDisclosure";

export type AdapterSettingItemProps = {
  label: string;
  summary?: React.ReactNode;
  iconName?: string;

  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;

  /**
   * Disables the enable switch and all controls passed as children.
   * Note: we intentionally do NOT disable the disclosure itself so the user can still inspect settings.
   */
  disabled?: boolean;

  children: React.ReactNode;
};

/**
 * Adapter settings item.
 *
 * Collapsed: one-line label + enable switch.
 * Expanded: unified block with summary + configuration.
 */
export function AdapterSettingItem(props: AdapterSettingItemProps) {
  const { label, summary, iconName, enabled, onEnabledChange, disabled, children } = props;

  return (
    <SettingDisclosure
      title={label}
      iconName={iconName}
      ariaLabel={`Adapter settings: ${label}`}
      right={
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          aria-label={`Enable adapter: ${label}`}
          disabled={disabled}
        />
      }
    >
      {summary ? (
        <div className="devNoteText muted" style={{ marginTop: 0 }}>
          {summary}
        </div>
      ) : null}

      {children}
    </SettingDisclosure>
  );
}
