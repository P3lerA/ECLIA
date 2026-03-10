import { useCallback, useEffect, useRef, useState } from "react";
import { roleLabel } from "./symphonyTypes";
import type { NodeKindSchema } from "@eclia/symphony-protocol";

// ─── Node frequency tracking ──────────────────────────────

const NODE_FREQ_KEY = "sym-node-freq";
function getNodeFreq(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(NODE_FREQ_KEY) || "{}"); } catch { return {}; }
}
function bumpNodeFreq(kind: string) {
  const f = getNodeFreq();
  f[kind] = (f[kind] ?? 0) + 1;
  localStorage.setItem(NODE_FREQ_KEY, JSON.stringify(f));
}

// ─── Node menu (double-click to add) ──────────────────────

export function NodeMenu({
  x,
  y,
  nodeKinds,
  onAdd,
  onClose,
}: {
  x: number;
  y: number;
  nodeKinds: NodeKindSchema[];
  onAdd: (kind: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const freq = useRef(getNodeFreq());

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleAdd = useCallback((kind: string) => {
    bumpNodeFreq(kind);
    onAdd(kind);
  }, [onAdd]);

  const filtered = nodeKinds
    .filter((k) =>
      k.label.toLowerCase().includes(search.toLowerCase()) ||
      k.kind.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => (freq.current[b.kind] ?? 0) - (freq.current[a.kind] ?? 0));

  // Keep menu on-screen
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 240),
    top: Math.min(y, window.innerHeight - 360),
    zIndex: 30,
  };

  return (
    <div className="sym-node-menu" style={style}>
      <input
        ref={inputRef}
        className="sym-node-menu-search"
        placeholder="Search nodes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="sym-node-menu-list">
        {filtered.map((k) => (
          <button
            key={k.kind}
            className={`sym-node-menu-item sym-node-menu-item--${k.role}`}
            onClick={() => handleAdd(k.kind)}
          >
            <span className="sym-node-menu-item-role">{roleLabel(k.role)}</span>
            <span className="sym-node-menu-item-label">{k.label}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="sym-node-menu-empty">No matches</div>
        )}
      </div>
    </div>
  );
}
