import React from "react";

/**
 * Back-compat collapsible component.
 *
 * Kept to avoid transient "Cannot find module .../common/Collapsible" errors
 * while older imports are being removed in watch/IDE sessions.
 */
export function Collapsible({
  title,
  defaultOpen,
  children,
  right,
  variant
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  right?: React.ReactNode;
  variant?: "card" | "section";
}) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen));

  React.useEffect(() => {
    setOpen(Boolean(defaultOpen));
  }, [defaultOpen]);

  const cls = variant === "section" ? "collapsible collapsibleSection" : "collapsible";

  return (
    <details
      className={cls}
      open={open}
      onToggle={(e: React.SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open)}
    >
      <summary className="collapsibleSummary">
        <span className="collapsibleTitle">{title}</span>
        {right ? <span className="collapsibleRight">{right}</span> : null}
      </summary>
      <div className="collapsibleBody">{children}</div>
    </details>
  );
}
