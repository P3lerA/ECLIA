import React from "react";
import { useNavigate } from "react-router-dom";
import { useActiveSession, useAppDispatch, useAppState, useMessages } from "../../state/AppState";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { EcliaLogo } from "../common/EcliaLogo";
import { SegmentedSwitch, type SegmentedSwitchOption } from "../common/SegmentedSwitch";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";

import type { Message } from "../../core/types";

type StepMode = "final" | "full";

const STEP_OPTIONS: SegmentedSwitchOption<StepMode>[] = [
  { value: "final", label: "Final", title: "Show final answers only" },
  { value: "full", label: "Full", title: "Show full work process" }
];

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
      if (x.role === "assistant") {
        assistantIdxs.push(j);
      }
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
    // No post-tool assistant yet (tool still running) → show the latest assistant so far.
    if (!pick && assistantIdxs.length) {
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
  const navigate = useNavigate();
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

  const onLogoClick = React.useCallback(() => {
    dispatch({ type: "session/new" });
    navigate("/");
  }, [dispatch, navigate]);

  return (
    <div className="chatview">
      {/* Fixed (like the composer) so page scrolling never pushes it away. */}
      <div className="chatTopDock">
        <div className="chatTopDock-inner">
          <div className="chatview-head chatTopBar">
            <EcliaLogo size="md" onClick={onLogoClick} />
            <div className="chatview-title">
              <div className="title">{session.title}</div>
              <div className="meta">{session.meta}</div>
            </div>

            <div className="chatview-actions" aria-label="Actions">
              <SegmentedSwitch
                compact
                ariaLabel="Steps"
                options={STEP_OPTIONS}
                value={showWork ? "full" : "final"}
                onChange={(mode) => dispatch({ type: "settings/displayWorkProcess", enabled: mode === "full" })}
              />
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
