import React from "react";
import { useSendMessage } from "../chat/useSendMessage";
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
          <button className="prompt-send" onClick={() => void send()} aria-label="Send">
            <SendUpIcon />
          </button>
        }
      />

      <div className="landing-actions motion-item" style={delay(150)}>
        <button className="btn menu" onClick={onOpenMenu}>
          MENU
        </button>
        <ThemeCycleButton />
      </div>

      <div className="landing-hint motion-item" style={delay(210)}>
        ECLIA can make mistakes. Check before executing.
      </div>
    </div>
  );
}
