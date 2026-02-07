import React from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { runtime } from "../../core/runtime";
import type { ChatEvent } from "../../core/types";
import { apiGetSession, apiResetSession, toUiSession } from "../../core/api/sessions";

export function useSendMessage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const sendText = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();

      if (!trimmed) return;

      // Commands (client-side)
      if (trimmed === "/clear") {
        try {
          await apiResetSession(state.activeSessionId);
        } catch {
          // If the gateway is down, still clear locally.
        }
        dispatch({ type: "messages/clear", sessionId: state.activeSessionId });
        return;
      }

      if (trimmed === "/new") {
        // New session should be a *draft* (no gateway folder) until the first message.
        // This prevents a pile of empty .eclia/sessions/<id>/ directories.
        dispatch({ type: "session/new" });
        navigate("/", { replace: false });
        return;
      }

      // Normal message
      const sessionId = state.activeSessionId;

      // User message (local echo)
      dispatch({
        type: "message/add",
        sessionId,
        message: {
          id: crypto.randomUUID(),
          role: "user",
          createdAt: Date.now(),
          blocks: [{ type: "text", text: trimmed }]
        }
      });

      // Assistant streaming placeholder
      const assistantId = crypto.randomUUID();
      dispatch({ type: "assistant/stream/start", sessionId, messageId: assistantId });

      const transport = runtime.transports.get(state.transport);
      const abort = new AbortController();

      const onEvent = (evt: ChatEvent) => {
        dispatch({
          type: "log/push",
          item: {
            id: crypto.randomUUID(),
            tab:
              evt.type === "tool_call" || evt.type === "tool_result"
                ? "tools"
                : evt.type === "meta"
                  ? "context"
                  : "events",
            at: evt.at,
            type: evt.type,
            summary:
              evt.type === "delta"
                ? "delta"
                : evt.type === "error"
                  ? evt.message
                  : evt.type === "meta"
                    ? `meta ${evt.model}${evt.usedTokens ? ` ctx≈${evt.usedTokens}` : ""}`
                    : evt.type,
            data: evt
          }
        });

        if (evt.type === "delta") {
          dispatch({ type: "assistant/stream/append", sessionId, text: evt.text });
        }

        if (evt.type === "assistant_start") {
          // A new assistant message phase (e.g. after tool execution).
          // Finalize any existing streaming message to keep ordering sane.
          dispatch({ type: "assistant/stream/finalize", sessionId });
          dispatch({ type: "assistant/stream/start", sessionId, messageId: evt.messageId || crypto.randomUUID() });
        }

        if (evt.type === "assistant_end") {
          dispatch({ type: "assistant/stream/finalize", sessionId });
        }

        if (evt.type === "tool_call") {
          dispatch({
            type: "assistant/addBlocks",
            sessionId,
            blocks: [{ type: "tool", name: evt.name, status: "calling", payload: evt.args }]
          });
        }

        if (evt.type === "tool_result") {
          dispatch({
            type: "assistant/addBlocks",
            sessionId,
            blocks: [
              {
                type: "tool",
                name: evt.name,
                status: evt.ok ? "ok" : "error",
                payload: evt.result
              }
            ]
          });
        }

        if (evt.type === "done") {
          dispatch({ type: "assistant/stream/finalize", sessionId });
        }

        if (evt.type === "error") {
          dispatch({
            type: "assistant/addBlocks",
            sessionId,
            blocks: [{ type: "text", text: `[error] ${evt.message}` }]
          });
          dispatch({ type: "assistant/stream/finalize", sessionId });
        }
      };

      // "Unlimited" here means "do not truncate in the gateway".
      // The gateway still has its own safety clamps.
      const effectiveContextBudget = state.settings.contextLimitEnabled ? state.settings.contextTokenLimit : 1000000;

      try {
        await transport.streamChat(
          {
            sessionId,
            model: state.model,
            userText: trimmed,
            toolAccessMode: state.settings.execAccessMode,
            contextTokenLimit: effectiveContextBudget
          },
          { onEvent },
          abort.signal
        );
      } catch (e) {
        // Network / abort errors won't come as SSE "error" events.
        const msg = e instanceof Error ? e.message : "Request failed";
        dispatch({
          type: "assistant/addBlocks",
          sessionId,
          blocks: [{ type: "text", text: `[error] ${msg}` }]
        });
        dispatch({ type: "assistant/stream/finalize", sessionId });
      } finally {
        // Best-effort: re-sync this session from the gateway so IDs/blocks stay canonical.
        try {
          const { session, messages } = await apiGetSession(sessionId);
          const ui = toUiSession(session);
          dispatch({
            type: "session/update",
            sessionId,
            patch: { title: ui.title, updatedAt: ui.updatedAt, meta: ui.meta, localOnly: false }
          });
          dispatch({ type: "messages/set", sessionId, messages });
        } catch {
          // ignore
        }
      }
    },
    [
      state.activeSessionId,
      state.model,
      state.transport,
      state.settings.contextLimitEnabled,
      state.settings.contextTokenLimit,
      dispatch
    ]
  );

  return { sendText };
}
