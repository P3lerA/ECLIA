import React from "react";

/**
 * A lightweight, reusable disclosure/collapsible.
 * Uses native <details>/<summary> for accessibility and keyboard support.
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
    // Keep the initial state in sync if the caller changes defaultOpen.
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
