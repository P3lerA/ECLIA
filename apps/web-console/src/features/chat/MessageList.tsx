import React from "react";
import type { Message } from "../../core/types";
import { MessageBubble } from "./MessageBubble";

const STICKY_THRESHOLD_PX = 48;

function isElementScrollable(el: HTMLElement): boolean {
  // A tiny epsilon avoids rounding edge cases.
  return el.scrollHeight > el.clientHeight + 1;
}

function getWindowScrollBottomDistance(): number {
  const doc = document.documentElement;
  const scrollTop = window.scrollY ?? doc.scrollTop ?? 0;
  const viewport = window.innerHeight ?? doc.clientHeight ?? 0;
  return doc.scrollHeight - scrollTop - viewport;
}

export function MessageList({
  sessionId,
  messages
}: {
  sessionId: string;
  messages: Message[];
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Whether we should keep the view "pinned" to the bottom.
  // - true  => streaming / new messages will auto-scroll
  // - false => user has scrolled up, so don't fight them
  const stickToBottomRef = React.useRef(true);

  const updateStickiness = React.useCallback(() => {
    const el = ref.current;
    if (el && isElementScrollable(el)) {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance <= STICKY_THRESHOLD_PX;
      return;
    }

    // Fallback: if the window is the scroll container (e.g. flex height constraints
    // didn't apply in the current environment), keep the same behavior.
    stickToBottomRef.current = getWindowScrollBottomDistance() <= STICKY_THRESHOLD_PX;
  }, []);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "auto") => {
    const el = ref.current;

    if (el && isElementScrollable(el)) {
      // Scroll inside the message list (preferred).
      el.scrollTo({ top: el.scrollHeight, behavior });
      return;
    }

    // Fallback: scroll the page.
    const doc = document.documentElement;
    window.scrollTo({ top: doc.scrollHeight, behavior });
  }, []);

  // When entering a session, jump straight to the bottom.
  // Layout effect avoids a "flash" at the top on large histories.
  React.useLayoutEffect(() => {
    stickToBottomRef.current = true;
    // Wait a frame so layout (incl. fonts) settles before measuring heights.
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [sessionId, scrollToBottom]);

  // Track whether the user is near the bottom.
  React.useEffect(() => {
    const el = ref.current;

    updateStickiness();

    const onWinScroll = () => updateStickiness();
    window.addEventListener("scroll", onWinScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onWinScroll);
    };
  }, [updateStickiness]);

  // When new content arrives, keep following if we were already at the bottom.
  React.useEffect(() => {
    if (!stickToBottomRef.current) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messages, scrollToBottom]);

  return (
    <div ref={ref} className="message-list" onScroll={updateStickiness}>
      {messages.map((m) => (
        <MessageBubble key={m.id} msg={m} />
      ))}
    </div>
  );
}
