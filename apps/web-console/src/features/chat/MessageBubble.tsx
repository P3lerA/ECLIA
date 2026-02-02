import React from "react";
import type { Message } from "../../core/types";
import { runtime } from "../../core/runtime";

export function MessageBubble({ msg }: { msg: Message }) {
  const roleLabel =
    msg.role === "user" ? "USER" : msg.role === "assistant" ? "ASSISTANT" : "TOOL";

  const dotClass = msg.role === "assistant" ? "dot accent" : "dot";

  return (
    <div className={"msg " + msg.role}>
      <div className="bubble">
        <div className="role">
          <span className={dotClass} />
          {roleLabel}
          {msg.streaming ? <span className="muted">· streaming</span> : null}
        </div>

        {msg.blocks.map((b, i) => (
          <React.Fragment key={i}>{runtime.blocks.render(b)}</React.Fragment>
        ))}
      </div>
    </div>
  );
}
