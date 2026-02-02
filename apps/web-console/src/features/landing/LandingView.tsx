import React from "react";
import { useSendMessage } from "../chat/useSendMessage";

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

  return (
    <div className="landing">
      <div className="brand brand-lg" data-text="ECLIA">
        ECLIA
      </div>

      <div className="promptbar" role="search">
        <input
          className="prompt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入问题或 /命令…"
          aria-label="Prompt"
        />
        <button className="prompt-send" onClick={() => void send()} aria-label="Send">
          ↗
        </button>
      </div>

      <button className="btn menu" onClick={onOpenMenu}>
        MENU
      </button>

      <div className="landing-hint">
        Enter 发送。菜单里可以切换历史 session / 插件配置 / 设置。
      </div>
    </div>
  );
}
