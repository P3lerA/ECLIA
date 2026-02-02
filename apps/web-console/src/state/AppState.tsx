import React from "react";
import type { InspectorTabId, LogItem, Message, Session } from "../core/types";
import { makeInitialState } from "./initialState";
import { reducer, type Action, type AppState } from "./reducer";

const StateCtx = React.createContext<AppState | null>(null);
const DispatchCtx = React.createContext<React.Dispatch<Action> | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, makeInitialState);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState {
  const v = React.useContext(StateCtx);
  if (!v) throw new Error("useAppState must be used within AppStateProvider");
  return v;
}

export function useAppDispatch(): React.Dispatch<Action> {
  const v = React.useContext(DispatchCtx);
  if (!v) throw new Error("useAppDispatch must be used within AppStateProvider");
  return v;
}

// selectors（可选）
export function useActiveSession(): Session {
  const s = useAppState();
  const found = s.sessions.find((x) => x.id === s.activeSessionId);
  if (!found) throw new Error("active session not found");
  return found;
}

export function useMessages(sessionId: string): Message[] {
  const s = useAppState();
  return s.messagesBySession[sessionId] ?? [];
}

export function useLogs(tab: InspectorTabId): LogItem[] {
  const s = useAppState();
  return s.logsByTab[tab] ?? [];
}
