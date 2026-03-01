import React from "react";
import type { Block, Message } from "../../core/types";
import { runtime } from "../../core/runtime";

export const MessageBubble = React.memo(function MessageBubble({
  msg,
  plainOutput
}: {
  msg: Message;
  plainOutput: boolean;
}) {

  const roleLabel =
    msg.role === "user"
      ? "USER"
      : msg.role === "assistant"
        ? "ASSISTANT"
        : msg.role === "system"
          ? "SYSTEM"
          : "TOOL";

  const dotClass = msg.role === "assistant" ? "dot accent" : "dot";

  // In "plain output" mode, we want to display *verbatim* assistant text.
  // That means: do NOT interpret <think>...</think> as special blocks.
  // We still keep non-text blocks (e.g. tool blocks) that represent actual executions.
  const blocks: Block[] =
    plainOutput &&
    msg.role === "assistant" &&
    typeof msg.raw === "string"
      ? ([
          { type: "text", text: msg.raw },
          ...msg.blocks.filter((b) => b.type !== "text" && b.type !== "thought" && b.type !== "code")
        ] as Block[])
      : msg.blocks;

  return (
    <div className={"msg motion-msg " + msg.role} data-msg-id={msg.id}>
      <div className="bubble">
        <div className="role">
          <span className={dotClass} />
          {roleLabel}
          {msg.streaming ? <span className="muted">· streaming</span> : null}
        </div>

        {blocks.map((b, i) => {
          // Markdown parsing is intentionally deferred until the message is complete.
          // While streaming, render text blocks as plain text for stability and performance.
          if (!plainOutput && msg.streaming && b.type === "text") {
            return (
              <p key={i} className="block-text">
                {b.text}
              </p>
            );
          }

          return <React.Fragment key={i}>{runtime.blocks.render(b)}</React.Fragment>;
        })}
      </div>
    </div>
  );
});
