import React from "react";
import { useActiveSession, useMessages } from "../../state/AppState";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

export function ChatPanel() {
  const session = useActiveSession();
  const messages = useMessages(session.id);

  return (
    <>
      <section className="chat">
        <MessageList messages={messages} />
      </section>
      <Composer />
    </>
  );
}
