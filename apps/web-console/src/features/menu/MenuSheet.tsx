import React from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { usePresence } from "../motion/usePresence";

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type MenuView = "main" | "all-sessions";

export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { present, motion } = usePresence(open, { exitMs: 220 });

  const [view, setView] = React.useState<MenuView>("main");

  // Reset to the default view whenever the sheet closes.
  React.useEffect(() => {
    if (!open) setView("main");
  }, [open]);

  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const closeBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const lastActiveRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!present) return;

    // Remember focus before opening, restore it after unmount.
    if (open) lastActiveRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        // Simple focus trap (good enough for a prototype).
        const root = sheetRef.current;
        if (!root) return;
        const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1
        );
        if (nodes.length === 0) return;

        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    // Initial focus (only when opening)
    if (open) setTimeout(() => closeBtnRef.current?.focus(), 0);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      lastActiveRef.current?.focus?.();
    };
  }, [present, open, onClose]);

  if (!present) return null;

  const sectionDelay = (ms: number) =>
    ({ ["--motion-delay" as any]: `${ms}ms` }) as React.CSSProperties;

  const renderSessions = (sessions: typeof state.sessions) => {
    return (
      <div className="menu-list">
        <button
          className="btn subtle"
          onClick={() => {
            // New sessions are draft-only until the first message.
            // This avoids generating empty .eclia/sessions/* directories.
            dispatch({ type: "session/new" });
            navigate("/");
            onClose();
          }}
        >
          + New session
        </button>

        {sessions.map((s) => {
          const active = s.id === state.activeSessionId;
          return (
            <button
              key={s.id}
              className={"menu-item" + (active ? " active" : "")}
              onClick={() => {
                dispatch({ type: "session/select", sessionId: s.id });

                // Draft local sessions (no messages yet) should route to the landing view.
                const hasLocalMsgs = (state.messagesBySession[s.id]?.length ?? 0) > 0;
                const isDraft = Boolean(s.localOnly) && !hasLocalMsgs && !s.started;
                navigate(isDraft ? "/" : `/session/${s.id}`);
                onClose();
              }}
            >
              <div className="menu-item-main">{s.title}</div>
              <div className="menu-item-sub">{s.meta}</div>
            </button>
          );
        })}
      </div>
    );
  };

  const preview = state.sessions.slice(0, 5);

  return (
    <div
      className="menusheet-overlay motion-overlay"
      data-motion={motion}
      onMouseDown={onClose}
      aria-hidden={false}
    >
      <div
        className="menusheet motion-sheet"
        data-motion={motion}
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-title"
        ref={sheetRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="menusheet-head">
          <div id="menu-title" className="menusheet-title">
            {view === "all-sessions" ? "SESSIONS" : "MENU"}
          </div>

          <div className="menusheet-head-actions">
            {view === "all-sessions" ? (
              <button className="btn subtle" onClick={() => setView("main")} aria-label="Back to menu">
                Back
              </button>
            ) : null}

            <button ref={closeBtnRef} className="btn icon" onClick={onClose} aria-label="Close menu">
              ✕
            </button>
          </div>
        </div>

        <div className="menusheet-body">
          {/* Keep both views mounted to enable smooth transitions between them. */}
          <div className="menuNavStage" data-view={view}>
            {/* MAIN */}
            <div
              className="menuNavView menuNavView-main"
              aria-hidden={view !== "main"}
              {...(view !== "main" ? ({ inert: "" } as any) : {})}
            >
              <section className="menu-section motion-item" style={sectionDelay(40)}>
                <div className="menu-section-title">Sessions</div>
                {renderSessions(preview)}

                {state.sessions.length > 5 ? (
                  <div className="menu-section-foot">
                    <button className="btn subtle" onClick={() => setView("all-sessions")}>
                      All sessions
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="menu-section motion-item" style={sectionDelay(90)}>
                <div className="menu-section-title">Navigate</div>
                <div className="menu-list">
                  <button
                    className="menu-item"
                    onClick={() => {
                      navigate("/plugins");
                      onClose();
                    }}
                  >
                    <div className="menu-item-main">Plugins</div>
                    <div className="menu-item-sub">Enable/disable · Prototype config</div>
                  </button>

                  <button
                    className="menu-item"
                    onClick={() => {
                      navigate("/settings");
                      onClose();
                    }}
                  >
                    <div className="menu-item-main">Settings</div>
                    <div className="menu-item-sub">Appearance · Runtime · Diagnostics</div>
                  </button>
                </div>
              </section>
            </div>

            {/* ALL SESSIONS */}
            <div
              className="menuNavView menuNavView-all"
              aria-hidden={view !== "all-sessions"}
              {...(view !== "all-sessions" ? ({ inert: "" } as any) : {})}
            >
              <section className="menu-section motion-item" style={sectionDelay(40)}>
                <div className="menu-section-title">Sessions</div>
                {renderSessions(state.sessions)}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
