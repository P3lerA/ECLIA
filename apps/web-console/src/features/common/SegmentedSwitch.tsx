import React from "react";

export type SegmentedSwitchOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  title?: string;
};

export type SegmentedSwitchProps<T extends string> = {
  options: SegmentedSwitchOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  compact?: boolean;
  className?: string;
};

/**
 * Generic segmented switch (single-select).
 * Visual style is shared with the existing theme switch tokens/classes.
 */
export function SegmentedSwitch<T extends string>(props: SegmentedSwitchProps<T>) {
  const { options, value, onChange, ariaLabel, compact, className } = props;
  const rootClass = ["themeSwitch", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={rootClass} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={"themeSwitch-btn" + (active ? " active" : "")}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            title={o.title}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
