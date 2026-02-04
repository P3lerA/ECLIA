import React from "react";
import type { Session } from "../../core/types";
import { MenuAllSessionsView } from "./views/MenuAllSessionsView";
import { MenuMainView } from "./views/MenuMainView";

export type MenuRoute = "main" | "all-sessions";

/**
 * Small navigation state for the menu sheet.
 * Keep it separate from MenuSheet so MenuSheet can stay focused on:
 * - overlay/presence
 * - focus trap
 * - header actions
 */
export function useMenuNavigator(open: boolean) {
  const [route, setRoute] = React.useState<MenuRoute>("main");

  // Reset to the default route whenever the sheet closes.
  React.useEffect(() => {
    if (!open) setRoute("main");
  }, [open]);

  const canGoBack = route !== "main";
  const title = route === "all-sessions" ? "SESSIONS" : "MENU";
  const goBack = React.useCallback(() => setRoute("main"), []);

  return { route, setRoute, canGoBack, title, goBack };
}

export type MenuNavigatorProps = {
  route: MenuRoute;

  sessions: Session[];
  activeSessionId: string;

  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;

  onRequestAllSessions: () => void;
  onNavigate: (page: "plugins" | "settings") => void;
};

export function MenuNavigator(props: MenuNavigatorProps) {
  if (props.route === "all-sessions") {
    return (
      <MenuAllSessionsView
        sessions={props.sessions}
        activeSessionId={props.activeSessionId}
        onSelectSession={props.onSelectSession}
        onNewSession={props.onNewSession}
      />
    );
  }

  return (
    <MenuMainView
      sessions={props.sessions}
      activeSessionId={props.activeSessionId}
      onSelectSession={props.onSelectSession}
      onNewSession={props.onNewSession}
      onAllSessions={props.onRequestAllSessions}
      onNavigate={props.onNavigate}
    />
  );
}
