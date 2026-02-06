import React from "react";
import { useNavigate } from "react-router-dom";
import { useSendMessage } from "./useSendMessage";

export function ChatComposer({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { sendText } = useSendMessage();
  const navigate = useNavigate();
  const [text, setText] = React.useState("");

  const send = React.useCallback(async () => {
    const v = text;
    const trimmed = v.trim();
    if (!trimmed) return;
    setText("");
    await sendText(v);

    // /new creates a fresh session and should bring the user back to the landing view.
    if (trimmed === "/new") {
      navigate("/");
    }
  }, [navigate, sendText, text]);

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
