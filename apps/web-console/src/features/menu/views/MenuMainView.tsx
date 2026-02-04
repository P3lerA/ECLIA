import React from "react";
import type { Session } from "../../../core/types";
import { SessionsList } from "../components/SessionsList";

const sectionDelay = (ms: number) =>
  ({ ["--motion-delay" as any]: `${ms}ms` }) as React.CSSProperties;

export type MenuMainViewProps = {
  sessions: Session[];
  activeSessionId: string;

  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;

  onAllSessions: () => void;
  onNavigate: (page: "plugins" | "settings") => void;
};

export function MenuMainView(props: MenuMainViewProps) {
  const preview = props.sessions.slice(0, 5);

  return (
    <>
      {/* Sessions always comes first. */}
      <section className="menu-section motion-item" style={sectionDelay(40)}>
        <div className="menu-section-title">Sessions</div>

        <SessionsList
          sessions={preview}
          activeSessionId={props.activeSessionId}
          onSelectSession={props.onSelectSession}
          onNewSession={props.onNewSession}
        />

        {props.sessions.length > 5 ? (
          <div className="menu-section-foot">
            <button className="btn subtle" onClick={props.onAllSessions}>
              All sessions
            </button>
          </div>
        ) : null}
      </section>

      <section className="menu-section motion-item" style={sectionDelay(90)}>
        <div className="menu-section-title">Navigate</div>
        <div className="menu-list">
          <button className="menu-item" onClick={() => props.onNavigate("plugins")}>
            <div className="menu-item-main">Plugins</div>
            <div className="menu-item-sub">Enable/disable · Prototype config</div>
          </button>

          <button className="menu-item" onClick={() => props.onNavigate("settings")}>
            <div className="menu-item-main">Settings</div>
            <div className="menu-item-sub">Appearance · Runtime · Diagnostics</div>
          </button>
        </div>
      </section>
    </>
  );
}
