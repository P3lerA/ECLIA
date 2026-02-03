import React from "react";
import { useActiveSession, useMessages } from "../../state/AppState";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";

export function ChatView({
  onOpenMenu,
  dockFromLanding
}: {
  onOpenMenu: () => void;
  dockFromLanding?: boolean;
}) {
  const session = useActiveSession();
  const messages = useMessages(session.id);

  // One-shot docking animation when transitioning from Landing → Chat.
  const [dockMotion, setDockMotion] = React.useState<"enter" | undefined>(dockFromLanding ? "enter" : undefined);

  React.useEffect(() => {
    if (dockFromLanding) setDockMotion("enter");
  }, [dockFromLanding]);

  return (
    <div className="chatview">
      <div className="chatview-content motion-page">
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
      </div>

      <div
        className="composerDock motion-dock"
        data-motion={dockMotion}
        onAnimationEnd={() => setDockMotion(undefined)}
      >
        <div className="composerDock-inner">
          <ChatComposer onOpenMenu={onOpenMenu} />
        </div>
      </div>
    </div>
  );
}
