import React from "react";
import { useNavigate } from "react-router-dom";

type EcliaLogoSize = "sm" | "md" | "lg";

export function EcliaLogo({
  size = "md",
  className,
  style,
  to = "/",
  onClick,
  disabled = false
}: {
  size?: EcliaLogoSize;
  className?: string;
  style?: React.CSSProperties;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const navigate = useNavigate();

  const handleClick = React.useCallback(() => {
    if (disabled) return;
    if (onClick) {
      onClick();
      return;
    }
    navigate(to);
  }, [disabled, navigate, onClick, to]);

  const classes = ["brand", `brand-${size}`, "ecliaLogo", className].filter(Boolean).join(" ");

  return (
    <button type="button" className={classes} style={style} data-text="ECLIA" onClick={handleClick} disabled={disabled}>
      ECLIA
    </button>
  );
}
