import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";

export function SessionsPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  return (
    <>
      <div className="section">
        <button className="btn" onClick={() => dispatch({ type: "session/new" })}>
          + New
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          Sessions
        </span>
      </div>

      <div className="sessions">
        {state.sessions.map((s) => {
          const active = s.id === state.activeSessionId;
          return (
            <div
              key={s.id}
              className={"session" + (active ? " active" : "")}
              onClick={() => dispatch({ type: "session/select", sessionId: s.id })}
            >
              <div className="session-title">{s.title}</div>
              <div className="session-meta">{s.meta}</div>
            </div>
          );
        })}
      </div>

      <div className="section">
        <span className="muted" style={{ fontSize: 12 }}>
          Status
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Ready
        </span>
      </div>
    </>
  );
}
