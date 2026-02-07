import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { runtime } from "../../core/runtime";
import { makeId } from "../../core/ids";
import type { ChatEvent } from "../../core/types";

export function Composer() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const [text, setText] = React.useState("");
  const acRef = React.useRef<AbortController | null>(null);

  const pushLog = React.useCallback(
    (tab: "events" | "tools" | "context", type: string, summary: string, data?: unknown) => {
      dispatch({
        type: "log/push",
        item: { id: makeId(), tab, at: Date.now(), type, summary, data }
      });
    },
    [dispatch]
  );

  const addUserMessage = React.useCallback(
    (content: string) => {
      dispatch({
        type: "message/add",
        sessionId: state.activeSessionId,
        message: {
          id: makeId(),
          role: "user",
          createdAt: Date.now(),
          blocks: [{ type: "text", text: content }]
        }
      });
    },
    [dispatch, state.activeSessionId]
  );

  const send = React.useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setText("");

    // slash commands (very simple, but fine for a prototype)
    if (trimmed === "/clear") {
      dispatch({ type: "messages/clear", sessionId: state.activeSessionId });
      pushLog("events", "command", "clear messages");
      return;
    }
    if (trimmed === "/help") {
      dispatch({
        type: "assistant/addBlocks",
        sessionId: state.activeSessionId,
        blocks: [
          {
            type: "text",
            text:
              "Commands:\n" +
              "- /help  show help\n" +
              "- /clear clear current session\n\n" +
              "Transport: mock / sse (switch in Settings)"
          }
        ]
      });
      return;
    }

    addUserMessage(trimmed);

    // Abort any in-flight request before sending a new one
    acRef.current?.abort();
    runtime.transports.get(state.transport).abort?.();

    const ac = new AbortController();
    acRef.current = ac;

    dispatch({
      type: "assistant/stream/start",
      sessionId: state.activeSessionId,
      messageId: makeId()
    });

    pushLog("events", "send", `transport=${state.transport} model=${state.model}`, {
      textLen: trimmed.length
    });

    const transport = runtime.transports.get(state.transport);

    const onEvent = (evt: ChatEvent) => {
      if (evt.type === "meta") {
        pushLog("context", "meta", `session=${evt.sessionId} model=${evt.model}`, evt);
      } else if (evt.type === "delta") {
        dispatch({ type: "assistant/stream/append", sessionId: state.activeSessionId, text: evt.text });
      } else if (evt.type === "tool_call") {
        dispatch({
          type: "assistant/addBlocks",
          sessionId: state.activeSessionId,
          blocks: [{ type: "tool", name: evt.name, status: "calling", payload: evt.args }]
        });
        pushLog("tools", "tool_call", `${evt.name}`, evt.args);
      } else if (evt.type === "tool_result") {
        dispatch({
          type: "assistant/addBlocks",
          sessionId: state.activeSessionId,
          blocks: [{ type: "tool", name: evt.name, status: evt.ok ? "ok" : "error", payload: evt.result }]
        });
        pushLog("tools", "tool_result", `${evt.name}: ${evt.ok ? "ok" : "error"}`, evt.result);
      } else if (evt.type === "done") {
        dispatch({ type: "assistant/stream/finalize", sessionId: state.activeSessionId });
        pushLog("events", "done", "stream end");
      } else if (evt.type === "error") {
        dispatch({ type: "assistant/stream/finalize", sessionId: state.activeSessionId });
        dispatch({
          type: "assistant/addBlocks",
          sessionId: state.activeSessionId,
          blocks: [{ type: "text", text: `[error] ${evt.message}` }]
        });
        pushLog("events", "error", evt.message);
      }
    };

    try {
      await transport.streamChat(
        { sessionId: state.activeSessionId, model: state.model, userText: trimmed },
        { onEvent },
        ac.signal
      );
    } catch (err: any) {
      dispatch({ type: "assistant/stream/finalize", sessionId: state.activeSessionId });
      dispatch({
        type: "assistant/addBlocks",
        sessionId: state.activeSessionId,
        blocks: [{ type: "text", text: `[error] ${String(err?.message ?? err)}` }]
      });
      pushLog("events", "exception", String(err?.message ?? err));
    }
  }, [
    text,
    state.activeSessionId,
    state.model,
    state.transport,
    dispatch,
    addUserMessage,
    pushLog
  ]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <footer className="composer">
      <div className="chiprow">
        <span className="chip">System: default</span>
        <span className="chip">Tools: enabled</span>
        <span className="chip">Stream: on</span>
      </div>

      <div className="inputrow">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a message… Enter to send · Shift+Enter for newline · /help /clear"
        />
        <button className="btn send" onClick={() => void send()}>
          <span>Send</span>
        </button>
      </div>

      <div className="hint">
        This is a frontend shell: swap the transport to your backend to plug in real models, tools, memory, and RAG.
      </div>
    </footer>
  );
}
