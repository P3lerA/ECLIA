import React from "react";
import { useActiveSession, useMessages } from "../../state/AppState";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";

export function ChatView({ onOpenMenu }: { onOpenMenu: () => void }) {
  const session = useActiveSession();
  const messages = useMessages(session.id);

  return (
    <div className="chatview">
      <div className="chatview-head">
        <div className="brand brand-sm" data-text="ECLIA">
          ECLIA
        </div>
        <div className="chatview-title">
          <div className="title">{session.title}</div>
          <div className="meta">{session.meta}</div>
        </div>
      </div>

      <div className="chatview-body">
        <MessageList messages={messages} />
      </div>

      <ChatComposer onOpenMenu={onOpenMenu} />
    </div>
  );
}
