import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { runtime } from "../../core/runtime";
import type { TransportId } from "../../core/transport/TransportRegistry";

export function TopBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const transports = runtime.transports.list();

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="brand" data-text="ECLIA">
          ECLIA
        </div>
        <span className="tag">llm console</span>
      </div>

      <div className="topbar-right">
        <select
          className="select"
          value={state.transport}
          onChange={(e) =>
            dispatch({ type: "transport/set", transport: e.target.value as TransportId })
          }
          title="Transport"
        >
          {transports.map((t) => (
            <option key={t} value={t}>
              transport/{t}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={state.model}
          onChange={(e) => dispatch({ type: "model/set", model: e.target.value })}
          title="Model"
        >
          <option value="local/ollama">local/ollama</option>
          <option value="openai-compatible">openai-compatible</option>
          <option value="router/gateway">router/gateway</option>
        </select>

        <button className="btn primary">
          <span>Deploy</span>
        </button>
      </div>
    </div>
  );
}
