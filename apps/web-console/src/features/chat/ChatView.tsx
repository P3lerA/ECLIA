import React from "react";
import { useActiveSession, useAppDispatch, useAppState, useMessages } from "../../state/AppState";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";

import type { Message } from "../../core/types";

function collapseMessagesToFinalPerTurn(messages: Message[]): Message[] {
  const out: Message[] = [];
  const safe = Array.isArray(messages) ? messages : [];

  // A "turn" is delimited by user messages.
  // Keep:
  // - the user message, and
  // - the final assistant message of that turn
  // Hide:
  // - tool bubbles
  // - intermediate assistant bubbles (e.g. pre-tool calls)
  let i = 0;
  while (i < safe.length) {
    const m = safe[i];
    if (!m) {
      i++;
      continue;
    }

    // Prelude (system / assistant) before the first user message: keep as-is.
    if (m.role !== "user") {
      out.push(m);
      i++;
      continue;
    }

    // Start of a turn.
    out.push(m);

    // Scan until next user message.
    let j = i + 1;
    let lastToolIdx = -1;
    const assistantIdxs: number[] = [];

    while (j < safe.length) {
      const x = safe[j];
      if (!x) {
        j++;
        continue;
      }
      if (x.role === "user") break;
      if (x.role === "tool") lastToolIdx = j;
      if (x.role === "assistant") assistantIdxs.push(j);
      j++;
    }

    // Prefer the last assistant message that happens *after* the last tool bubble
    // (so we don't show a pre-tool "planning" assistant in collapsed mode).
    let pick: Message | null = null;
    for (let k = assistantIdxs.length - 1; k >= 0; k--) {
      const idx = assistantIdxs[k];
      if (lastToolIdx >= 0 && idx <= lastToolIdx) continue;
      pick = safe[idx] ?? null;
      break;
    }
    // No post-tool assistant yet (tool still running) → show nothing (user only).
    if (!pick && lastToolIdx < 0 && assistantIdxs.length) {
      pick = safe[assistantIdxs[assistantIdxs.length - 1]] ?? null;
    }

    if (pick) out.push(pick);
    i = j;
  }

  return out;
}

export function ChatView({
  onOpenMenu,
  dockFromLanding
}: {
  onOpenMenu: () => void;
  dockFromLanding?: boolean;
}) {
  const session = useActiveSession();
  const state = useAppState();
  const dispatch = useAppDispatch();
  const messages = useMessages(session.id);

  const showWork = Boolean(state.settings.displayWorkProcess);
  const viewMessages = React.useMemo(
    () => (showWork ? messages : collapseMessagesToFinalPerTurn(messages)),
    [messages, showWork]
  );

  // One-shot docking animation when transitioning from Landing → Chat.
  const [dockMotion, setDockMotion] = React.useState<"enter" | undefined>(dockFromLanding ? "enter" : undefined);

  React.useEffect(() => {
    if (dockFromLanding) setDockMotion("enter");
  }, [dockFromLanding]);

  return (
    <div className="chatview">
      {/* Fixed (like the composer) so page scrolling never pushes it away. */}
      <div className="chatTopDock">
        <div className="chatTopDock-inner">
          <div className="chatview-head chatTopBar">
            <div className="brand brand-md" data-text="ECLIA">
              ECLIA
            </div>
            <div className="chatview-title">
              <div className="title">{session.title}</div>
              <div className="meta">{session.meta}</div>
            </div>

            <div className="chatview-actions" aria-label="Actions">
              <div className="themeSwitch compact" role="group" aria-label="Work process">
                <button
                  type="button"
                  className={"themeSwitch-btn" + (showWork ? " active" : "")}
                  aria-pressed={showWork}
                  onClick={() =>
                    dispatch({ type: "settings/displayWorkProcess", enabled: !showWork })
                  }
                  title={showWork ? "Hide work process" : "Show work process"}
                >
                  Steps
                </button>
              </div>
              <ThemeModeSwitch compact />
            </div>
          </div>
        </div>
      </div>

      <div className="chatview-body motion-page">
        <MessageList sessionId={session.id} messages={viewMessages} />
      </div>

      <div
        className="composerDock motion-dock"
        data-motion={dockMotion}
        onAnimationEnd={() => setDockMotion(undefined)}
      >
        <div className="composerDock-inner">
          <ChatComposer onOpenMenu={onOpenMenu} />
        </div>
      </div>
    </div>
  );
}
