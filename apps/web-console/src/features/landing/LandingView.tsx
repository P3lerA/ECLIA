import React from "react";
import { useNavigate } from "react-router-dom";
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

export function LandingView({ onOpenMenu }: { onOpenMenu: () => void }) {
  const navigate = useNavigate();
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
          <button className="prompt-send" onClick={() => void send()} aria-label="Send">
            <SendUpIcon />
          </button>
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
          <span className="treble-clef" aria-hidden="true">{"\uD834\uDD1E"}</span>
        </button>
        <ThemeCycleButton />
      </div>

      <div className="landing-hint motion-item" style={delay(210)}>
        ECLIA can make mistakes. Check before executing.
      </div>
    </div>
  );
}
