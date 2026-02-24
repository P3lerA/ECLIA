import React from "react";
import { usePresence } from "../../motion/usePresence";

export type SettingsAdvancedSectionProps = {
  children: React.ReactNode;
  title?: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
};

/**
 * Reusable "Advanced" section for Settings.
 *
 * - Subtitle-style appearance (no outer frame)
 * - Controlled internally (like a disclosure)
 * - Uses presence + data-motion for simple enter/exit animation
 */
export function SettingsAdvancedSection(props: SettingsAdvancedSectionProps) {
  const { children, title = "Advanced", defaultOpen, right, className, ariaLabel } = props;

  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  React.useEffect(() => {
    setOpen(Boolean(defaultOpen));
  }, [defaultOpen]);

  const { present, motion } = usePresence(open, { exitMs: 160 });
  const bodyId = React.useId();
  const cls = ["collapsible", "collapsibleSection", className].filter(Boolean).join(" ");

  return (
    <div className={cls} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="collapsibleSummary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={ariaLabel}
      >
        <span className="collapsibleTitle">{title}</span>
        {right ? <span className="collapsibleRight">{right}</span> : null}
      </button>

      {present ? (
        <div className="collapsibleBody motion-disclosure" data-motion={motion} id={bodyId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
