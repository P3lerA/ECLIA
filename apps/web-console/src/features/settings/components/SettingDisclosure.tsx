import React from "react";
import { Icon } from "@iconify/react";
import { usePresence } from "../../motion/usePresence";

export type SettingDisclosureProps = {
  title: React.ReactNode;
  icon?: React.ReactNode;
  iconName?: string;
  right?: React.ReactNode;
  children: React.ReactNode;

  /**
   * Controlled open state.
   * If provided, the component becomes controlled.
   */
  open?: boolean;

  /**
   * Uncontrolled initial open state.
   * Also used as a sync target if it changes.
   */
  defaultOpen?: boolean;

  /**
   * Called whenever the disclosure is toggled.
   */
  onOpenChange?: (open: boolean) => void;

  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

/**
 * Settings disclosure row.
 *
 * - Header stays one line (title + optional right slot).
 * - Expands into a single, unified block (no separate "inner card").
 * - Uses a native <button> for keyboard accessibility.
 */
export function SettingDisclosure(props: SettingDisclosureProps) {
  const { title, icon, iconName, right, children, open, defaultOpen, onOpenChange, disabled, className, ariaLabel } = props;

  const isControlled = typeof open === "boolean";
  const [internalOpen, setInternalOpen] = React.useState(Boolean(defaultOpen));

  React.useEffect(() => {
    if (!isControlled) setInternalOpen(Boolean(defaultOpen));
  }, [defaultOpen, isControlled]);

  const isOpen = isControlled ? Boolean(open) : internalOpen;
  const bodyId = React.useId();
  const { present, motion } = usePresence(isOpen, { exitMs: 160 });

  const toggle = () => {
    if (disabled) return;
    const next = !isOpen;

    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div
      className={["settingDisclosure", className].filter(Boolean).join(" ")}
      data-open={isOpen ? "true" : "false"}
    >
      <div className="settingDisclosureHeader">
        <button
          type="button"
          className="settingDisclosureSummary"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          aria-label={ariaLabel}
          disabled={disabled}
        >
          <span className="settingDisclosureTitle">
            <span className="disclosureIcon" aria-hidden="true">
              {icon ?? (iconName ? <Icon icon={iconName} width={14} height={14} fallback={isOpen ? "▾" : "▸"} /> : isOpen ? "▾" : "▸")}
            </span>
            {title}
          </span>
        </button>

        {right ? <div className="settingDisclosureRight">{right}</div> : null}
      </div>

      {present ? (
        <div className="settingDisclosureBody motion-disclosure" id={bodyId} data-motion={motion}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
