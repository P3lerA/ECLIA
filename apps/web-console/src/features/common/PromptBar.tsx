import React from "react";

export type PromptBarProps = {
  className?: string;
  style?: React.CSSProperties;
  role?: React.AriaRole;
  ariaLabel?: string;
  input: React.ReactNode;
  actions?: React.ReactNode;
  actionsClassName?: string;
};

/**
 * Shared prompt/composer bar shell.
 *
 * Layout stays consistent across Landing and Chat; callers only provide:
 * - input control node
 * - action button node(s)
 */
export function PromptBar(props: PromptBarProps) {
  const { className, style, role, ariaLabel, input, actions, actionsClassName } = props;

  return (
    <div className={className} style={style} role={role} aria-label={ariaLabel}>
      {input}
      {actions ? <div className={actionsClassName ?? "promptbar-actions"}>{actions}</div> : null}
    </div>
  );
}
