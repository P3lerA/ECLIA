import React from "react";
import { useSendMessage } from "./useSendMessage";

export function ChatComposer({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { sendText } = useSendMessage();
  const [text, setText] = React.useState("");

  const send = React.useCallback(async () => {
    const v = text;
    if (!v.trim()) return;
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
      <div className="inputrow">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a message…  Enter to send · Shift+Enter for newline · /help /clear /new"
        />

        <div className="actions">
          <button className="btn icon" onClick={onOpenMenu} aria-label="Menu">
            ☰
          </button>
          <button className="btn icon send" onClick={() => void send()} aria-label="Send">
            ↗
          </button>
        </div>
      </div>
    </footer>
  );
}
