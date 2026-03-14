import React from "react";
import { apiFetch } from "../../../../core/api/apiFetch";
import { parseSSE } from "../../../../core/transport/sseParser";
import { useAppState } from "../../../../state/AppState";
import { ModelRouteSelect } from "../../components/ModelRouteSelect";
import type { ModelRouteOption } from "../../settingsUtils";

type Role = "system" | "user" | "assistant" | "tool";

type PlaygroundMessage = {
  id: string;
  role: Role | string;
  content: string;
  customRole: boolean;
};

const BUILTIN_ROLES: Role[] = ["system", "user", "assistant", "tool"];

let nextId = 1;
function makeId() {
  return `pg-${nextId++}`;
}

function defaultMessages(): PlaygroundMessage[] {
  return [
    { id: makeId(), role: "system", content: "", customRole: false },
    { id: makeId(), role: "user", content: "", customRole: false }
  ];
}

export type PlaygroundSectionProps = {
  modelRouteOptions: ModelRouteOption[];
};

export function PlaygroundSection(props: PlaygroundSectionProps) {
  const { modelRouteOptions } = props;
  const state = useAppState();
  const sessionId = state.activeSessionId;

  const [messages, setMessages] = React.useState<PlaygroundMessage[]>(defaultMessages);
  const [model, setModel] = React.useState(state.model);
  const [output, setOutput] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const acRef = React.useRef<AbortController | null>(null);

  const addMessage = () => {
    setMessages((prev) => [...prev, { id: makeId(), role: "user", content: "", customRole: false }]);
  };

  const removeMessage = (id: string) => {
    setMessages((prev) => (prev.length <= 1 ? prev : prev.filter((m) => m.id !== id)));
  };

  const updateRole = (id: string, value: string) => {
    if (value === "__custom") {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, role: "", customRole: true } : m)));
    } else {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, role: value, customRole: false } : m)));
    }
  };

  const updateCustomRole = (id: string, value: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, role: value } : m)));
  };

  const updateContent = (id: string, content: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)));
  };

  const stop = () => {
    acRef.current?.abort();
    acRef.current = null;
  };

  const run = async () => {
    stop();
    setOutput("");
    setError(null);
    setRunning(true);

    const ac = new AbortController();
    acRef.current = ac;

    try {
      const resp = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          sessionId,
          model,
          userText: "",
          rawMode: true,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          enabledTools: []
        }),
        signal: ac.signal
      });

      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const { events, rest } = parseSSE(buffer);
        buffer = rest;

        for (const e of events) {
          if (e.event === "delta") {
            try {
              const j = JSON.parse(e.data);
              if (typeof j?.text === "string") {
                setOutput((prev) => prev + j.text);
              }
            } catch { /* skip */ }
          }
          if (e.event === "error") {
            try {
              const j = JSON.parse(e.data);
              setError(String(j?.message ?? "error"));
            } catch {
              setError("Unknown error");
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setError(String(err?.message ?? err));
      }
    } finally {
      setRunning(false);
      acRef.current = null;
    }
  };

  return (
    <div>
      <div className="pg-toolbar">
        <div className="pg-toolbar-left">
          <ModelRouteSelect
            value={model}
            onChange={setModel}
            options={modelRouteOptions}
            className="select"
            defaultLabel="(active model)"
            includeDefaultOption
          />
        </div>
        <button type="button" className="btn" onClick={addMessage}>+ New message</button>
      </div>

      <div className="pg-messages">
        {messages.map((m) => (
          <div key={m.id} className="pg-msg">
            <div className="pg-msg-head">
              {m.customRole ? (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    className="pg-role-input"
                    value={m.role}
                    onChange={(e) => updateCustomRole(m.id, e.target.value)}
                    placeholder="custom role..."
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn icon"
                    style={{ width: 24, height: 24, borderRadius: 6, fontSize: 11 }}
                    title="Switch back to preset roles"
                    onClick={() => updateRole(m.id, "user")}
                  >&times;</button>
                </div>
              ) : (
                <select
                  className="select"
                  value={m.role}
                  onChange={(e) => updateRole(m.id, e.target.value)}
                  style={{ padding: "4px 8px", borderRadius: 8, fontSize: "12px" }}
                >
                  {BUILTIN_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                  <option value="__custom">custom...</option>
                </select>
              )}
              <button
                type="button"
                className="btn icon"
                style={{ width: 28, height: 28, borderRadius: 8, fontSize: 14 }}
                title="Remove"
                disabled={messages.length <= 1}
                onClick={() => removeMessage(m.id)}
              >&minus;</button>
            </div>
            <textarea
              className="pg-msg-content"
              value={m.content}
              onChange={(e) => updateContent(m.id, e.target.value)}
              placeholder={m.role === "system" ? "System instruction..." : "Message content..."}
              rows={3}
            />
          </div>
        ))}
      </div>

      <div className="pg-controls">
        {running ? (
          <button type="button" className="btn btn-discard" onClick={stop}>Stop</button>
        ) : (
          <button type="button" className="btn" onClick={run}>Run</button>
        )}
      </div>

      {(output || error) && (
        <div className="pg-output">
          <div className="pg-output-label">Response</div>
          {error && <div className="pg-error">{error}</div>}
          {output && <pre className="pg-output-text">{output}</pre>}
        </div>
      )}
    </div>
  );
}
