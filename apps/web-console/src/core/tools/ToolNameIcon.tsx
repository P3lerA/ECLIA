import type { CSSProperties } from "react";
import execIconSvg from "../../assets/tool/exec.svg?raw";
import sendIconSvg from "../../assets/tool/send.svg?raw";
import webIconSvg from "../../assets/tool/web.svg?raw";

const TOOL_ICON_SVGS: Record<string, string> = {
  exec: execIconSvg,
  send: sendIconSvg,
  web: webIconSvg
};

export type ToolNameIconProps = {
  name: string;
  className?: string;
  size?: number;
};

export function ToolNameIcon(props: ToolNameIconProps) {
  const { name, className, size = 14 } = props;
  const svg = TOOL_ICON_SVGS[name];
  if (!svg) return null;

  const style = {
    width: size,
    height: size
  } satisfies CSSProperties;

  return (
    <span
      className={["toolNameIcon", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
