import React from "react";

export type SettingsToggleRowProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Reusable settings toggle row:
 * - clickable full row (label wrapper)
 * - shared row typography/layout
 * - right-aligned checkbox
 */
export function SettingsToggleRow(props: SettingsToggleRowProps) {
  const { title, description, checked, onCheckedChange, ariaLabel, disabled, className } = props;
  const cls = ["row", className].filter(Boolean).join(" ");

  return (
    <label className={cls}>
      <div className="row-left">
        <div className="row-main">{title}</div>
        {description ? <div className="row-sub muted">{description}</div> : null}
      </div>

      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        aria-label={ariaLabel}
        disabled={disabled}
      />
    </label>
  );
}
