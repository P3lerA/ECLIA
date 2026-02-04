import React from "react";
import { useSendMessage } from "../chat/useSendMessage";
import { ThemeCycleButton } from "../theme/ThemeCycleButton";

export function LandingView({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { sendText } = useSendMessage();
  const [text, setText] = React.useState("");

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
      <div className="brand brand-lg motion-item" style={delay(0)} data-text="ECLIA">
        ECLIA
      </div>

      <div className="promptbar motion-item" style={delay(90)} role="search">
        <input
          className="prompt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything or type a /command…"
          aria-label="Prompt"
        />
        <button className="prompt-send" onClick={() => void send()} aria-label="Send">
          ↗
        </button>
      </div>

      <div className="landing-actions motion-item" style={delay(150)}>
        <button className="btn menu" onClick={onOpenMenu}>
          MENU
        </button>
        <ThemeCycleButton />
      </div>

      <div className="landing-hint motion-item" style={delay(210)}>
        Press Enter to send. MENU: Sessions / Plugins / Settings (fallback toggle lives in Settings).
      </div>
    </div>
  );
}
