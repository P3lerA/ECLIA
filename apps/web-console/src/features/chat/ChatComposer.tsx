import React from "react";
import { PromptBar } from "../common/PromptBar";
import { useSendMessage } from "./useSendMessage";
import { useAppDispatch, useAppState } from "../../state/AppState";

function ExecFullAccessIcon({ className }: { className?: string }) {
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

function ExecSafeModeIcon({ className }: { className?: string }) {
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

export function ChatComposer({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { sendText } = useSendMessage();
  const [text, setText] = React.useState("");

  const state = useAppState();
  const dispatch = useAppDispatch();

  const accessMode = state.settings.toolAccessMode;
  const toggleAccessMode = React.useCallback(() => {
    dispatch({
      type: "settings/toolAccessMode",
      mode: accessMode === "full" ? "safe" : "full"
    });
  }, [accessMode, dispatch]);

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
              onClick={toggleAccessMode}
              aria-label="Tool access mode"
              title={`Tool access: ${accessMode === "full" ? "full" : "safe"}`}
            >
              {accessMode === "full" ? (
                <ExecFullAccessIcon className="execModeIcon" />
              ) : (
                <ExecSafeModeIcon className="execModeIcon" />
              )}
            </button>
            <button className="chatbar-btn" onClick={onOpenMenu} aria-label="Menu">
              <MenuIcon className="execModeIcon" />
            </button>
            <button className="chatbar-btn" onClick={() => void send()} aria-label="Send">
              <SendUpIcon className="execModeIcon" />
            </button>
          </>
        }
      />
    </footer>
  );
}
