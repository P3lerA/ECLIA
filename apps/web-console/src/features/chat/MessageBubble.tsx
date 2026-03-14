import React from "react";
import type { Block, Message } from "../../core/types";
import { runtime } from "../../core/runtime";

function phaseLabel(phase: string | null | undefined): string {
  switch (phase) {
    case "recalling": return "recalling\u2026";
    case "generating": return "streaming";
    case "tool_executing": return "calling tool\u2026";
    default: return "streaming";
  }
}

export const MessageBubble = React.memo(function MessageBubble({
  msg,
  plainOutput,
  phase
}: {
  msg: Message;
  plainOutput: boolean;
  phase?: string | null;
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

  // Single-pass partition: separate iteration blocks from the rest for computer_use layout.
  const { iterBlocks, otherBlocks, isComputerUse } = React.useMemo(() => {
    let hasComputerUse = false;
    const iters: Block[] = [];
    const rest: Block[] = [];
    for (const b of blocks) {
      if (b.type === "computer_use_iteration" || b.type === "computer_use_done") {
        hasComputerUse = true;
      }
      if (b.type === "computer_use_iteration") {
        iters.push(b);
      } else {
        rest.push(b);
      }
    }
    return { iterBlocks: iters, otherBlocks: rest, isComputerUse: hasComputerUse };
  }, [blocks]);

  return (
    <div className={"msg motion-msg " + msg.role} data-msg-id={msg.id}>
      <div className="bubble">
        <div className="role">
          <span className={dotClass} />
          {roleLabel}
          {msg.streaming ? <span className="muted">· {phaseLabel(phase)}</span> : null}
        </div>

        {isComputerUse ? (<>
          <div className="block-cu-scroll">
            {iterBlocks.map((b, i) => (
              <React.Fragment key={i}>{runtime.blocks.render(b)}</React.Fragment>
            ))}
          </div>
          {otherBlocks.map((b, i) => (
            <React.Fragment key={i}>{runtime.blocks.render(b)}</React.Fragment>
          ))}
        </>) : (
          blocks.map((b, i) => {
            if (!plainOutput && msg.streaming && b.type === "text") {
              return (
                <p key={i} className="block-text">
                  {b.text}
                </p>
              );
            }
            return <React.Fragment key={i}>{runtime.blocks.render(b)}</React.Fragment>;
          })
        )}
      </div>
    </div>
  );
});
