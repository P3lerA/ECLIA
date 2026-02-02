import React from "react";
import { useAppDispatch, useAppState, useLogs } from "../../state/AppState";
import type { InspectorTabId } from "../../core/types";

const TABS: Array<{ id: InspectorTabId; title: string }> = [
  { id: "events", title: "Events" },
  { id: "tools", title: "Tools" },
  { id: "context", title: "Context" }
];

export function InspectorPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const logs = useLogs(state.inspectorTab);

  return (
    <>
      <div className="inspector-head">
        <div className="inspector-title">Inspector</div>
        <div className="tabs">
          {TABS.map((t) => (
            <div
              key={t.id}
              className={"tab" + (state.inspectorTab === t.id ? " active" : "")}
              onClick={() => dispatch({ type: "inspector/tab", tab: t.id })}
            >
              {t.title}
            </div>
          ))}
        </div>
      </div>

      <div className="inspector-body">
        <div className="log">
          {logs.slice(0, 30).map((item) => (
            <div key={item.id} className="log-row">
              <div className="muted">
                {new Date(item.at).toLocaleTimeString()} · {item.type}
              </div>
              <div>{item.summary}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
