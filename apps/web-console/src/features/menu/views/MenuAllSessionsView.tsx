import React from "react";
import type { Session } from "../../../core/types";
import { SessionsList } from "../components/SessionsList";

const sectionDelay = (ms: number) =>
  ({ ["--motion-delay" as any]: `${ms}ms` }) as React.CSSProperties;

export type MenuAllSessionsViewProps = {
  sessions: Session[];
  activeSessionId: string;

  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
};

export function MenuAllSessionsView(props: MenuAllSessionsViewProps) {
  return (
    <section className="menu-section motion-item" style={sectionDelay(40)}>
      <div className="menu-section-title">Sessions</div>

      <SessionsList
        sessions={props.sessions}
        activeSessionId={props.activeSessionId}
        onSelectSession={props.onSelectSession}
        onNewSession={props.onNewSession}
      />
    </section>
  );
}
