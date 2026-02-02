import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { runtime } from "../../core/runtime";
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
        item: { id: crypto.randomUUID(), tab, at: Date.now(), type, summary, data }
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
          id: crypto.randomUUID(),
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

    // slash commands（非常简陋，但够用）
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
              "- /help  显示帮助\n" +
              "- /clear 清空当前会话\n\n" +
              "Transport: mock / sse（右上角切换）"
          }
        ]
      });
      return;
    }

    addUserMessage(trimmed);

    // 新请求打断旧请求
    acRef.current?.abort();
    runtime.transports.get(state.transport).abort?.();

    const ac = new AbortController();
    acRef.current = ac;

    dispatch({
      type: "assistant/stream/start",
      sessionId: state.activeSessionId,
      messageId: crypto.randomUUID()
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
          placeholder="输入内容，Enter 发送；Shift+Enter 换行。支持 /help /clear"
        />
        <button className="btn send" onClick={() => void send()}>
          <span>Send</span>
        </button>
      </div>

      <div className="hint">
        这是前端壳：把 transport 换成你的后端即可接入真实模型、工具、记忆与 RAG。
      </div>
    </footer>
  );
}
