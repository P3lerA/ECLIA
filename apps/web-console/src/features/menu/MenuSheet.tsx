import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { usePresence } from "../motion/usePresence";
import { apiDeleteSession } from "../../core/api/sessions";

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type MenuView = "main" | "all-sessions";

export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const { present, motion } = usePresence(open, { exitMs: 220 });

  const [view, setView] = React.useState<MenuView>("main");

  const [manageMode, setManageMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());

  // Reset to the default view whenever the sheet closes.
  React.useEffect(() => {
    if (!open) {
      setView("main");
      setManageMode(false);
      setSelectedIds(new Set());
    }
  }, [open]);

  // Leaving the "all-sessions" view should also exit manage mode.
  React.useEffect(() => {
    if (view !== "all-sessions") {
      setManageMode(false);
      setSelectedIds(new Set());
    }
  }, [view]);

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

  const toggleSelected = (sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const clearSelected = () => setSelectedIds(new Set());

  const allSessionIds = state.sessions.map((s) => s.id);

  const allSelected =
    manageMode && allSessionIds.length > 0 && allSessionIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allSessionIds.length === 0) return new Set();
      const isAll = allSessionIds.every((id) => prev.has(id));
      return isAll ? new Set() : new Set(allSessionIds);
    });
  };


  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const ok = window.confirm(
      `Delete ${ids.length} session${ids.length === 1 ? "" : "s"}?\n\nThis will also delete their artifacts.`
    );
    if (!ok) return;

    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      const s = state.sessions.find((x) => x.id === id);
      // Local-only draft sessions exist only in UI memory.
      if (s?.localOnly) {
        deleted.push(id);
        continue;
      }

      try {
        await apiDeleteSession(id);
        deleted.push(id);
      } catch (e) {
        const msg = String((e as any)?.message ?? e);
        failed.push({ id, error: msg });
      }
    }

    if (deleted.length > 0) {
      dispatch({ type: "sessions/remove", sessionIds: deleted });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of deleted) next.delete(id);
        return next;
      });

      // If the user just deleted the session they're currently viewing, bounce to landing
      // to avoid recreating it as a local placeholder.
      if (deleted.includes(state.activeSessionId) && location.pathname.startsWith("/session/")) {
        navigate("/", { replace: true });
      }
    }

    if (failed.length > 0) {
      // Keep it simple: show a basic error so the user knows which ones failed.
      window.alert(
        `Failed to delete ${failed.length} session${failed.length === 1 ? "" : "s"}:\n\n` +
          failed.map((f) => `${f.id}: ${f.error}`).join("\n")
      );
    }
  };

  const renderSessions = (sessions: typeof state.sessions, opts?: { manage?: boolean }) => {
    const manage = Boolean(opts?.manage);
    return (
      <div className="menu-list">
        {!manage ? (
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
        ) : null}

        {sessions.map((s) => {
          const active = s.id === state.activeSessionId;
          const selected = manage && selectedIds.has(s.id);
          return (
            <button
              key={s.id}
              className={"menu-item" + (active ? " active" : "") + (selected ? " selected" : "")}
              onClick={() => {
                if (manage) {
                  toggleSelected(s.id);
                  return;
                }
                // Close the menu first, then navigate on the next frame so
                // the close animation isn't blocked by the heavy ChatView render.
                onClose();

                // Draft local sessions (no messages yet) should route to the landing view.
                const hasLocalMsgs = (state.messagesBySession[s.id]?.length ?? 0) > 0;
                const isDraft = Boolean(s.localOnly) && !hasLocalMsgs && !s.started;
                requestAnimationFrame(() => {
                  if (isDraft) {
                    dispatch({ type: "session/select", sessionId: s.id });
                    navigate("/");
                  } else {
                    navigate(`/session/${s.id}`, {
                      state: { dockFromLanding: location.pathname === "/" }
                    });
                  }
                });
              }}
            >
              {manage ? (
                <div className="menu-item-row">
                  <div className="menu-item-text">
                    <div className="menu-item-main">{s.title}</div>
                    <div className="menu-item-sub">{s.meta}</div>
                  </div>
                  <input
                    className="menu-item-check"
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelected(s.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={selected ? `Deselect session ${s.title}` : `Select session ${s.title}`}
                  />
                </div>
              ) : (
                <>
                  <div className="menu-item-main">{s.title}</div>
                  <div className="menu-item-sub">{s.meta}</div>
                </>
              )}
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
              <>
                {manageMode ? (
                  <button
                    className="btn subtle"
                    onClick={toggleSelectAll}
                    disabled={state.sessions.length === 0}
                    aria-label={allSelected ? "Unselect all sessions" : "Select all sessions"}
                  >
                    {allSelected ? "Unselect all" : "Select all"}
                  </button>
                ) : null}

                {manageMode ? (
                  <button
                    className="btn subtle"
                    onClick={() => {
                      void deleteSelected();
                    }}
                    disabled={selectedIds.size === 0}
                    aria-label="Delete selected sessions"
                  >
                    Delete
                  </button>
                ) : null}

                <button
                  className="btn subtle"
                  onClick={() => {
                    setManageMode((v) => {
                      const next = !v;
                      if (!next) clearSelected();
                      return next;
                    });
                  }}
                  aria-label={manageMode ? "Exit manage mode" : "Manage sessions"}
                >
                  {manageMode ? "Done" : "Manage"}
                </button>

                <button
                  className="btn subtle"
                  onClick={() => {
                    setView("main");
                    setManageMode(false);
                    clearSelected();
                  }}
                  aria-label="Back to menu"
                >
                  Back
                </button>
              </>
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
                      navigate("/settings");
                      onClose();
                    }}
                  >
                    <div className="menu-item-main">Settings</div>
                  </button>

                  <button
                    className="menu-item"
                    onClick={() => {
                      navigate("/plugins");
                      onClose();
                    }}
                  >
                    <div className="menu-item-main">Plugins</div>
                  </button>

                  <button
                    className="menu-item"
                    onClick={() => {
                      navigate("/memory");
                      onClose();
                    }}
                  >
                    <div className="menu-item-main">Memory</div>
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
                <div className="menuManageStage" data-view={manageMode ? "manage" : "browse"}>
                  <div
                    className="menuManageView menuManageView-browse"
                    aria-hidden={manageMode}
                    {...(manageMode ? ({ inert: "" } as any) : {})}
                  >
                    {renderSessions(state.sessions)}
                  </div>

                  <div
                    className="menuManageView menuManageView-manage"
                    aria-hidden={!manageMode}
                    {...(!manageMode ? ({ inert: "" } as any) : {})}
                  >
                    {renderSessions(state.sessions, { manage: true })}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
