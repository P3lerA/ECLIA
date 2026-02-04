import React from "react";
import type { Session } from "../../../core/types";

export type SessionsListProps = {
  sessions: Session[];
  activeSessionId: string;

  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
};

/**
 * Reusable session list for the menu sheet.
 * Keep it dumb: all actions are passed in from the parent.
 */
export function SessionsList(props: SessionsListProps) {
  return (
    <div className="menu-list">
      <button className="btn subtle" onClick={props.onNewSession}>
        + New session
      </button>

      {props.sessions.map((s) => {
        const active = s.id === props.activeSessionId;
        return (
          <button
            key={s.id}
            className={"menu-item" + (active ? " active" : "")}
            onClick={() => props.onSelectSession(s.id)}
          >
            <div className="menu-item-main">{s.title}</div>
            <div className="menu-item-sub">{s.meta}</div>
          </button>
        );
      })}
    </div>
  );
}
