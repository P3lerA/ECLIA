import { useSyncExternalStore } from "react";
import type { Message, Session } from "../core/types";
import { makeInitialState } from "./initialState";
import { reducer, type Action, type AppState } from "./reducer";

// ---------------------------------------------------------------------------
// External store (module-level singleton)
// ---------------------------------------------------------------------------

let currentState: AppState = makeInitialState();
const listeners = new Set<() => void>();

function storeDispatch(action: Action): void {
  currentState = reducer(currentState, action);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getState(): AppState {
  return currentState;
}

// ---------------------------------------------------------------------------
// Direct store access (for async callbacks that need the latest state).
// ---------------------------------------------------------------------------

export { getState };

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Select a slice of state. The component only re-renders when the selected
 * value changes (compared by Object.is).
 *
 * Prefer this over useAppState() for components that read a small subset.
 */
export function useAppSelector<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(currentState));
}

/** Returns the full state. Re-renders on every dispatch — use useAppSelector where possible. */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export function useAppDispatch(): React.Dispatch<Action> {
  return storeDispatch;
}

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------

const EMPTY_MESSAGES: Message[] = [];

export function useActiveSession(): Session {
  return useAppSelector((s) => {
    const found = s.sessions.find((x) => x.id === s.activeSessionId);
    if (!found) throw new Error("active session not found");
    return found;
  });
}

export function useMessages(sessionId: string): Message[] {
  return useAppSelector((s) => s.messagesBySession[sessionId] ?? EMPTY_MESSAGES);
}

export function useHasMore(sessionId: string): boolean {
  return useAppSelector((s) => Boolean(s.hasMoreBySession[sessionId]));
}
