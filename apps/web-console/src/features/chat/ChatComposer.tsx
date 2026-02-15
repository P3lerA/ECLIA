import React from "react";
import { useSendMessage } from "./useSendMessage";
import { useAppDispatch, useAppState } from "../../state/AppState";

function ExecFullAccessIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 5v14l8-7-8-7zm9 0v14l8-7-8-7z" />
    </svg>
  );
}

function ExecSafeModeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 5h3v14H3zM8 5v14l13-7-13-7z" />
    </svg>
  );
}

export function ChatComposer({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { sendText } = useSendMessage();
  const [text, setText] = React.useState("");

  const state = useAppState();
  const dispatch = useAppDispatch();

  const accessMode = state.settings.execAccessMode;
  const toggleAccessMode = React.useCallback(() => {
    dispatch({
      type: "settings/execAccessMode",
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
      <div className="chatbar" role="group" aria-label="Composer">
        <textarea
          className="chatbar-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a message…  Enter to send · Shift+Enter for newline · /help /clear(reset) /new(new session)"
        />

        <div className="chatbar-actions" aria-label="Actions">
          <button
            className="chatbar-btn"
            onClick={toggleAccessMode}
            aria-label="Exec access mode"
            title={`Exec access: ${accessMode === "full" ? "full" : "safe"}`}
          >
            {accessMode === "full" ? (
              <ExecFullAccessIcon className="execModeIcon" />
            ) : (
              <ExecSafeModeIcon className="execModeIcon" />
            )}
          </button>
          <button className="chatbar-btn" onClick={onOpenMenu} aria-label="Menu">
            ☰
          </button>
          <button className="chatbar-btn" onClick={() => void send()} aria-label="Send">
            ↗
          </button>
        </div>
      </div>
    </footer>
  );
}
