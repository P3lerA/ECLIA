import React from "react";
import { apiFetch } from "../../../../core/api/apiFetch";
import { parseSSE } from "../../../../core/transport/sseParser";
import { useAppSelector } from "../../../../state/AppState";
import { ModelRouteSelect } from "../../components/ModelRouteSelect";
import type { ModelRouteOption } from "../../settingsUtils";

type PlaygroundMessage = {
  id: string;
  role: string;
  content: string;
  customRole: boolean;
};

const BUILTIN_ROLES = ["system", "user", "assistant", "tool"] as const;

let _pgId = 0;
function pgId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return pgId();
  return `pg-${++_pgId}-${Date.now()}`;
}

export type PlaygroundSectionProps = {
  modelRouteOptions: ModelRouteOption[];
};

export function PlaygroundSection(props: PlaygroundSectionProps) {
  const { modelRouteOptions } = props;
  const sessionId = useAppSelector((s) => s.activeSessionId);
  const globalModel = useAppSelector((s) => s.model);

  const [messages, setMessages] = React.useState<PlaygroundMessage[]>(() => [
    { id: pgId(), role: "system", content: "", customRole: false },
    { id: pgId(), role: "user", content: "", customRole: false }
  ]);
  const [model, setModel] = React.useState(globalModel);
  const [output, setOutput] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const acRef = React.useRef<AbortController | null>(null);

  // Accumulate deltas into a ref; flush to state on rAF for fewer re-renders.
  const chunksRef = React.useRef<string[]>([]);
  const rafRef = React.useRef<number | null>(null);

  const flushChunks = React.useCallback(() => {
    rafRef.current = null;
    const pending = chunksRef.current;
    if (!pending.length) return;
    const joined = pending.join("");
    chunksRef.current = [];
    setOutput((prev) => prev + joined);
  }, []);

  // Abort in-flight request on unmount.
  React.useEffect(() => {
    return () => {
      acRef.current?.abort();
      acRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const addMessage = () => {
    setMessages((prev) => [...prev, { id: pgId(), role: "user", content: "", customRole: false }]);
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
                chunksRef.current.push(j.text);
                if (rafRef.current == null) {
                  rafRef.current = requestAnimationFrame(flushChunks);
                }
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
      // Flush any remaining buffered chunks.
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      const remaining = chunksRef.current;
      if (remaining.length) {
        const joined = remaining.join("");
        chunksRef.current = [];
        setOutput((prev) => prev + joined);
      }
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
                <div className="pg-custom-role-row">
                  <input
                    className="pg-role-input"
                    value={m.role}
                    onChange={(e) => updateCustomRole(m.id, e.target.value)}
                    placeholder="custom role..."
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn icon pg-role-reset-btn"
                    title="Switch back to preset roles"
                    onClick={() => updateRole(m.id, "user")}
                  >&times;</button>
                </div>
              ) : (
                <select
                  className="select pg-role-select"
                  value={m.role}
                  onChange={(e) => updateRole(m.id, e.target.value)}
                >
                  {BUILTIN_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                  <option value="__custom">custom...</option>
                </select>
              )}
              <button
                type="button"
                className="btn icon pg-remove-btn"
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
