import React from "react";
import { useNavigate } from "react-router-dom";
import { getState, useAppDispatch, useAppState } from "../../state/AppState";
import { useSendMessage } from "../chat/useSendMessage";
import { EcliaLogo } from "../common/EcliaLogo";
import { PromptBar } from "../common/PromptBar";
import { ThemeCycleButton } from "../theme/ThemeCycleButton";

function SendUpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 18V6.5" />
      <path d="M7 11.5 12 6.5l5 5" />
    </svg>
  );
}

function MousePointerClickIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 4.1 12 6" />
      <path d="m5.1 8-2.9-.8" />
      <path d="m6 12-1.9 2" />
      <path d="M7.2 2.2 8 5.1" />
      <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />
    </svg>
  );
}

function MessageSquareTextIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <path d="M7 11h10" />
      <path d="M7 15h6" />
      <path d="M7 7h8" />
    </svg>
  );
}

function MusicFourIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 18V5l12-2v13" />
      <path d="m9 9 12-2" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function LandingView({ onOpenMenu }: { onOpenMenu: () => void }) {
  const navigate = useNavigate();
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { sendText } = useSendMessage();
  const [text, setText] = React.useState("");

  const opMode = state.settings.operationMode;
  const toggleOpMode = React.useCallback(() => {
    dispatch({
      type: "settings/set",
      key: "operationMode",
      value: opMode === "chat" ? "computer_use" : "chat"
    });
  }, [opMode, dispatch]);

  // If the active session already has messages (e.g. user navigated back via
  // browser history), ensure we switch to a fresh draft so the next message
  // doesn't silently land in the previous conversation.
  React.useEffect(() => {
    const s = getState();
    const msgs = s.messagesBySession[s.activeSessionId];
    const hasMessages = Array.isArray(msgs) && msgs.length > 0;
    const session = s.sessions.find((x) => x.id === s.activeSessionId);
    if (hasMessages || session?.started) {
      dispatch({ type: "session/new" });
    }
  }, [dispatch]);

  const send = React.useCallback(async () => {
    const v = text;
    if (!v.trim()) return;
    setText("");
    await sendText(v);
  }, [sendText, text]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  };

  const delay = (ms: number) => ({ ["--motion-delay" as any]: `${ms}ms` }) as React.CSSProperties;

  return (
    <div className="landing">
      <EcliaLogo size="lg" className="motion-item" style={delay(0)} />

      <PromptBar
        className="promptbar motion-item"
        style={delay(90)}
        role="search"
        ariaLabel="Prompt"
        input={
          <input
            className="prompt-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask ECLIA anything or type a /command…"
            aria-label="Prompt"
          />
        }
        actions={
          <>
            <button
              className="prompt-send"
              onClick={toggleOpMode}
              aria-label="Operation mode"
              title={opMode === "computer_use" ? "Computer use" : "Chat"}
            >
              {opMode === "computer_use" ? <MousePointerClickIcon /> : <MessageSquareTextIcon />}
            </button>
            <button className="prompt-send" onClick={() => void send()} aria-label="Send">
              <SendUpIcon />
            </button>
          </>
        }
      />

      <div className="landing-actions motion-item" style={delay(150)}>
        <button className="btn icon landing-circle" onClick={onOpenMenu} aria-label="Menu">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
        </button>
        <button className="btn icon landing-circle" onClick={() => navigate("/settings")} aria-label="Settings">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 10.27 7 3.34"/><path d="m11 13.73-4 6.93"/><path d="M12 22v-2"/><path d="M12 2v2"/><path d="M14 12h8"/><path d="m17 20.66-1-1.73"/><path d="m17 3.34-1 1.73"/><path d="M2 12h2"/><path d="m20.66 17-1.73-1"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m3.34 7 1.73 1"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8"/></svg>
        </button>
        <button className="btn icon landing-circle" onClick={() => navigate("/symphony")} aria-label="Symphony">
          <MusicFourIcon />
        </button>
        <ThemeCycleButton />
      </div>

      <div className="landing-hint motion-item" style={delay(210)}>
        ECLIA can make mistakes. Check before executing.
      </div>
    </div>
  );
}
