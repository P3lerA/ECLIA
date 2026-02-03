import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { usePresence } from "../motion/usePresence";

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const { present, motion } = usePresence(open, { exitMs: 220 });

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

  const sectionDelay = (ms: number) => ({ ["--motion-delay" as any]: `${ms}ms` }) as React.CSSProperties;

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
            MENU
          </div>
          <button
            ref={closeBtnRef}
            className="btn icon"
            onClick={onClose}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <div className="menusheet-body">
          <section className="menu-section motion-item" style={sectionDelay(40)}>
            <div className="menu-section-title">Navigate</div>
            <div className="menu-list">
              <button
                className="menu-item"
                onClick={() => {
                  dispatch({ type: "nav/to", page: "settings" });
                  onClose();
                }}
              >
                <div className="menu-item-main">Settings</div>
                <div className="menu-item-sub">Transport · Model · Background</div>
              </button>
            </div>
          </section>

          <section className="menu-section motion-item" style={sectionDelay(80)}>
            <div className="menu-section-title">Sessions</div>

            <div className="menu-list">
              <button
                className="btn subtle"
                onClick={() => {
                  dispatch({ type: "session/new" });
                  onClose();
                }}
              >
                + New session
              </button>

              {state.sessions.map((s) => {
                const active = s.id === state.activeSessionId;
                return (
                  <button
                    key={s.id}
                    className={"menu-item" + (active ? " active" : "")}
                    onClick={() => {
                      dispatch({ type: "session/select", sessionId: s.id });
                      onClose();
                    }}
                  >
                    <div className="menu-item-main">{s.title}</div>
                    <div className="menu-item-sub">{s.meta}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="menu-section motion-item" style={sectionDelay(120)}>
            <div className="menu-section-title">Plugins</div>
            <div className="menu-list">
              {state.plugins.map((p) => (
                <label key={p.id} className="menu-toggle">
                  <div className="menu-toggle-main">
                    <div className="menu-item-main">{p.name}</div>
                    <div className="menu-item-sub">{p.description ?? ""}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={() => dispatch({ type: "plugin/toggle", pluginId: p.id })}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="menu-section motion-item" style={sectionDelay(160)}>
            <div className="menu-section-title">Diagnostics</div>
            <div className="menu-diag">
              <div className="menu-diag-row">
                <div className="muted">events</div>
                <div className="muted">{state.logsByTab.events[0]?.summary ?? "-"}</div>
              </div>
              <div className="menu-diag-row">
                <div className="muted">tools</div>
                <div className="muted">{state.logsByTab.tools[0]?.summary ?? "-"}</div>
              </div>
              <div className="menu-diag-row">
                <div className="muted">context</div>
                <div className="muted">{state.logsByTab.context[0]?.summary ?? "-"}</div>
              </div>

              <div className="menu-diag-actions">
                <button
                  className="btn subtle"
                  onClick={() => {
                    dispatch({ type: "messages/clear", sessionId: state.activeSessionId });
                    onClose();
                  }}
                >
                  Clear messages
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
