import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getState, useAppDispatch } from "../../state/AppState";
import { runtime } from "../../core/runtime";
import { makeId } from "../../core/ids";
import type { ChatEvent } from "../../core/types";
import { apiGetSession, apiResetSession, toUiSession } from "../../core/api/sessions";
import { supportsComputerUse } from "../../core/configCache";

export function useSendMessage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const sendText = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();

      if (!trimmed) return;

      // Snapshot the current state at call time — no stale closures.
      const state = getState();

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

      // If the user is on the landing page, sending a message should transition into
      // the chat route for the *current* active session. (Router-driven navigation.)
      //
      // Note: we do this early so the UI swaps views immediately, while the SSE stream
      // continues to update global state.
      if (location.pathname === "/") {
        navigate(`/session/${encodeURIComponent(sessionId)}`, {
          replace: true,
          state: { dockFromLanding: true }
        });
      }

      // User message (local echo)
      dispatch({
        type: "message/add",
        sessionId,
        message: {
          id: makeId(),
          role: "user",
          createdAt: Date.now(),
          blocks: [{ type: "text", text: trimmed }]
        }
      });

      // Assistant streaming placeholder
      const assistantId = makeId();
      dispatch({ type: "assistant/stream/start", sessionId, messageId: assistantId });

      // Validate computer_use mode requires a Responses API profile.
      const opMode = state.settings.operationMode;
      if (opMode === "computer_use" && !supportsComputerUse(state.model)) {
        dispatch({
          type: "assistant/stream/append",
          sessionId,
          text: "Computer use requires an OpenAI-compatible profile with Responses API (wire_format = \"responses\"). Change the wire format in Settings or switch back to chat mode."
        });
        dispatch({ type: "assistant/stream/finalize", sessionId });
        return;
      }

      const transport = runtime.transports.get(state.transport);
      const abort = new AbortController();

      const onEvent = (evt: ChatEvent) => {
        if (evt.type === "phase") {
          dispatch({ type: "session/setPhase", sessionId, phase: evt.phase });
        }

        if (evt.type === "delta") {
          dispatch({ type: "assistant/stream/append", sessionId, text: evt.text });
        }

        if (evt.type === "assistant_start") {
          // A new assistant message phase (e.g. after tool execution).
          // Finalize any existing streaming message to keep ordering sane.
          dispatch({ type: "assistant/stream/finalize", sessionId });
          dispatch({ type: "assistant/stream/start", sessionId, messageId: evt.messageId || makeId() });
        }

        if (evt.type === "assistant_end") {
          dispatch({ type: "assistant/stream/finalize", sessionId });
        }

        if (evt.type === "tool_call") {
          // Tool calls belong to the *assistant* message (OpenAI semantics).
          // Render them as blocks inside the most recent assistant bubble.
          const payload =
            evt.callId && typeof evt.callId === "string"
              ? { ...(evt.args as any), callId: evt.callId }
              : evt.args;

          dispatch({
            type: "assistant/appendBlocksToLast",
            sessionId,
            blocks: [{ type: "tool", name: evt.name, status: "calling", payload }]
          });
        }

        if (evt.type === "tool_result") {
          dispatch({
            type: "message/add",
            sessionId,
            message: {
              id: makeId(),
              role: "tool",
              createdAt: evt.at,
              blocks: [
                {
                  type: "tool",
                  name: evt.name,
                  status: evt.ok ? "ok" : "error",
                  payload: evt.result
                }
              ]
            }
          });
        }

        if (evt.type === "done") {
          dispatch({ type: "assistant/stream/finalize", sessionId });
          dispatch({ type: "session/setPhase", sessionId, phase: null });
        }

        if (evt.type === "error") {
          dispatch({
            type: "assistant/addBlocks",
            sessionId,
            blocks: [{ type: "text", text: `[error] ${evt.message}` }]
          });
          dispatch({ type: "assistant/stream/finalize", sessionId });
          dispatch({ type: "session/setPhase", sessionId, phase: null });
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
            toolAccessMode: state.settings.toolAccessMode,
            contextTokenLimit: effectiveContextBudget,
            temperature: state.settings.temperature ?? undefined,
            topP: state.settings.topP ?? undefined,
            topK: state.settings.topK ?? undefined,
            maxOutputTokens: state.settings.maxOutputTokens ?? undefined,
            operationMode: opMode !== "chat" ? opMode : undefined
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
        dispatch({ type: "session/setPhase", sessionId, phase: null });
      } finally {
        // Best-effort: re-sync this session from the gateway so IDs/blocks stay canonical.
        // Guard: only apply the sync if the user hasn't navigated away to a different session,
        // otherwise we'd overwrite state for a session that's no longer in view.
        if (getState().settings.sessionSyncEnabled && getState().activeSessionId === sessionId) {
          try {
            const { session, messages, hasMore } = await apiGetSession(sessionId);
            if (getState().activeSessionId !== sessionId) return; // changed during fetch
            const ui = toUiSession(session);
            dispatch({
              type: "session/update",
              sessionId,
              patch: { title: ui.title, updatedAt: ui.updatedAt, meta: ui.meta, localOnly: false }
            });
            dispatch({ type: "messages/set", sessionId, messages, hasMore });
          } catch {
            // ignore
          }
        }
      }
    },
    [location.pathname, navigate, dispatch]
  );

  return { sendText };
}
