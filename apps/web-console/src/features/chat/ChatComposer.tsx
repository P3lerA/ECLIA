import React from "react";
import { PromptBar } from "../common/PromptBar";
import { useSendMessage } from "./useSendMessage";
import { useAppDispatch, useAppState } from "../../state/AppState";

function BashFullAccessIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.5 5.5 11.5 12l-6 6.5" />
      <path d="M12.5 5.5 18.5 12l-6 6.5" />
    </svg>
  );
}

function BashSafeModeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 5.5v13" />
      <path d="M10 5.5 18.5 12 10 18.5" />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.5 7h13" />
      <path d="M5.5 12h13" />
      <path d="M5.5 17h13" />
    </svg>
  );
}

function SendUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
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

function MousePointerClickIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
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

function MessageSquareTextIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 20, height: 20 }}
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

export function ChatComposer({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { sendText } = useSendMessage();
  const [text, setText] = React.useState("");

  const state = useAppState();
  const dispatch = useAppDispatch();

  const accessMode = state.settings.toolAccessMode;
  const toggleAccessMode = React.useCallback(() => {
    dispatch({
      type: "settings/set",
      key: "toolAccessMode",
      value: accessMode === "full" ? "safe" : "full"
    });
  }, [accessMode, dispatch]);

  const opMode = state.settings.operationMode;
  const toggleOpMode = React.useCallback(() => {
    dispatch({
      type: "settings/set",
      key: "operationMode",
      value: opMode === "chat" ? "computer_use" : "chat"
    });
  }, [opMode, dispatch]);

  const send = React.useCallback(async () => {
    const v = text;
    const trimmed = v.trim();
    if (!trimmed) return;
    setText("");
    await sendText(v);
  }, [sendText, text]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <footer className="composer composer-chat">
      <PromptBar
        className="chatbar"
        role="group"
        ariaLabel="Composer"
        actionsClassName="chatbar-actions"
        input={
          <textarea
            className="chatbar-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask ECLIA anything or type a /command…"
          />
        }
        actions={
          <>
            <button
              className="chatbar-btn"
              onClick={toggleOpMode}
              aria-label="Operation mode"
              title={opMode === "computer_use" ? "Computer use" : "Chat"}
            >
              {opMode === "computer_use" ? (
                <MousePointerClickIcon className="bashModeIcon" />
              ) : (
                <MessageSquareTextIcon className="bashModeIcon" />
              )}
            </button>
            <button
              className="chatbar-btn"
              onClick={toggleAccessMode}
              aria-label="Tool access mode"
              title={`Tool access: ${accessMode === "full" ? "full" : "safe"}`}
            >
              {accessMode === "full" ? (
                <BashFullAccessIcon className="bashModeIcon" />
              ) : (
                <BashSafeModeIcon className="bashModeIcon" />
              )}
            </button>
            <button className="chatbar-btn" onClick={onOpenMenu} aria-label="Menu">
              <MenuIcon className="bashModeIcon" />
            </button>
            <button className="chatbar-btn" onClick={() => void send()} aria-label="Send">
              <SendUpIcon className="bashModeIcon" />
            </button>
          </>
        }
      />
    </footer>
  );
}
