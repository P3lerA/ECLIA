import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { runtime } from "../../core/runtime";
import type { ChatEvent } from "../../core/types";

export function useSendMessage() {
  const state = useAppState();
  const dispatch = useAppDispatch();

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

  const addAssistantBlocks = React.useCallback(
    (blocks: any[]) => {
      dispatch({ type: "assistant/addBlocks", sessionId: state.activeSessionId, blocks: blocks as any });
    },
    [dispatch, state.activeSessionId]
  );

  const runCommand = React.useCallback(
    (cmd: string) => {
      switch (cmd) {
        case "/clear":
          dispatch({ type: "messages/clear", sessionId: state.activeSessionId });
          pushLog("events", "command", "clear messages");
          return true;

        case "/help":
          addAssistantBlocks([
            {
              type: "text",
              text:
                "Commands:\n" +
                "- /help  显示帮助\n" +
                "- /clear 清空当前会话\n" +
                "- /new   新建空会话（回到 Landing）\n"
            }
          ]);
          return true;

        case "/new":
          dispatch({ type: "session/new" });
          pushLog("events", "command", "new session");
          return true;

        default:
          return false;
      }
    },
    [dispatch, state.activeSessionId, addAssistantBlocks, pushLog]
  );

  const sendText = React.useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      // command
      if (trimmed.startsWith("/") && runCommand(trimmed)) return;

      addUserMessage(trimmed);

      // 新请求打断旧请求（同时支持 transport.abort 和 AbortController）
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
          dispatch({
            type: "assistant/stream/append",
            sessionId: state.activeSessionId,
            text: evt.text
          });
        } else if (evt.type === "tool_call") {
          dispatch({
            type: "assistant/addBlocks",
            sessionId: state.activeSessionId,
            blocks: [{ type: "tool", name: evt.name, status: "calling", payload: evt.args }]
          });
          pushLog("tools", "tool_call", evt.name, evt.args);
        } else if (evt.type === "tool_result") {
          dispatch({
            type: "assistant/addBlocks",
            sessionId: state.activeSessionId,
            blocks: [
              {
                type: "tool",
                name: evt.name,
                status: evt.ok ? "ok" : "error",
                payload: evt.result
              }
            ]
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
    },
    [addUserMessage, dispatch, pushLog, runCommand, state.activeSessionId, state.model, state.transport]
  );

  return { sendText };
}
