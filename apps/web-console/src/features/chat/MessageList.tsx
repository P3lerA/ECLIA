import React from "react";
import type { Message } from "../../core/types";
import { MessageBubble } from "./MessageBubble";
import { apiGetSession } from "../../core/api/sessions";
import { useAppDispatch, useHasMore } from "../../state/AppState";

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
  messages,
  plainOutput
}: {
  sessionId: string;
  messages: Message[];
  plainOutput: boolean;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const dispatch = useAppDispatch();
  const hasMore = useHasMore(sessionId);
  const loadingMoreRef = React.useRef(false);
  const [loadingMore, setLoadingMore] = React.useState(false);

  // Track the id of the first visible message so we can restore scroll position after prepending.
  const prevFirstIdRef = React.useRef<string | null>(null);

  const loadEarlier = React.useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    // Remember the current first message id before loading.
    if (messages.length > 0) {
      prevFirstIdRef.current = messages[0].id;
    }

    try {
      const currentCount = messages.length;
      const { messages: allMessages, hasMore: more } = await apiGetSession(sessionId, { tail: currentCount + 50 });
      dispatch({ type: "messages/set", sessionId, messages: allMessages, hasMore: more });
    } catch {
      // ignore
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [sessionId, messages, hasMore, dispatch]);

  // After messages change from a "load earlier" operation, restore scroll to the previous first message.
  React.useLayoutEffect(() => {
    const anchorId = prevFirstIdRef.current;
    if (!anchorId) return;

    const el = ref.current;
    if (!el) return;

    const anchorEl = el.querySelector(`[data-msg-id="${CSS.escape(anchorId)}"]`);
    if (anchorEl) {
      (anchorEl as HTMLElement).scrollIntoView({ block: "start" });
    }
    prevFirstIdRef.current = null;
  }, [messages]);

  // Whether we should keep the view "pinned" to the bottom.
  // - true  => streaming / new messages will auto-scroll
  // - false => user has scrolled up, so don't fight them
  const stickToBottomRef = React.useRef(true);

  // True between session entry and the first batch of messages arriving.
  // Prevents updateStickiness from overriding stickToBottom or triggering loadEarlier
  // while scroll is at 0 simply because content hasn't loaded yet.
  const enteringRef = React.useRef(true);

  const updateStickiness = React.useCallback(() => {
    if (enteringRef.current) return;

    const el = ref.current;
    if (el && isElementScrollable(el)) {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance <= STICKY_THRESHOLD_PX;

      // Auto-load when scrolled to the top.
      if (el.scrollTop <= STICKY_THRESHOLD_PX) {
        loadEarlier();
      }
      return;
    }

    // Fallback: if the window is the scroll container (e.g. flex height constraints
    // didn't apply in the current environment), keep the same behavior.
    const winDist = getWindowScrollBottomDistance();
    stickToBottomRef.current = winDist <= STICKY_THRESHOLD_PX;

    if ((window.scrollY ?? 0) <= STICKY_THRESHOLD_PX) {
      loadEarlier();
    }
  }, [loadEarlier]);

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
    enteringRef.current = true;
    // Wait a frame so layout (incl. fonts) settles before measuring heights.
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [sessionId, scrollToBottom]);

  // Track whether the user is near the bottom.
  React.useEffect(() => {
    updateStickiness();

    const onWinScroll = () => updateStickiness();
    window.addEventListener("scroll", onWinScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onWinScroll);
    };
  }, [updateStickiness]);

  // When new content arrives, keep following if we were already at the bottom.
  // On first load after session entry, always scroll to bottom.
  React.useEffect(() => {
    if (enteringRef.current) {
      // Don't consume the entering flag on empty messages — the real data
      // hasn't arrived yet (async fetch). If we clear it now, updateStickiness
      // will see scrollTop=0 and set stickToBottom=false before the real
      // messages render, preventing scroll-to-bottom.
      if (messages.length === 0) return;
      enteringRef.current = false;
      stickToBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom("auto"));
      return;
    }
    if (!stickToBottomRef.current) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messages, scrollToBottom]);

  return (
    <div ref={ref} className="message-list" onScroll={updateStickiness}>
      {loadingMore && (
        <div className="load-earlier">
          <span className="load-earlier-hint">Loading…</span>
        </div>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} msg={m} plainOutput={plainOutput} />
      ))}
    </div>
  );
}
