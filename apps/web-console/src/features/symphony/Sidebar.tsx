import { useCallback, useMemo, useRef, useState } from "react";
import { EcliaLogo } from "../common/EcliaLogo";
import { ThemeModeSwitch } from "../theme/ThemeModeSwitch";
import { roleLabel, PORT_COLORS } from "./symphonyTypes";
import type { NodeKindSchema, NodeRole, PortType } from "@eclia/symphony-protocol";
import { CFG_TO_PORT } from "@eclia/symphony-protocol";
import type { OpusListEntry } from "./symphonyTypes";

// ─── Sidebar ────────────────────────────────────────────────

export function Sidebar({
  opusList,
  activeId,
  activeName,
  activeRunning,
  dirty,
  onSelect,
  onCreate,
  onDelete,
  onToggleEnabled,
  onNameChange,
  onSave,
  onDiscard,
  onReload,
  hint,
  onBack,
  nodeKinds,
  onAddNode,
}: {
  opusList: OpusListEntry[];
  activeId: string | null;
  activeName: string | null;
  activeRunning: boolean;
  dirty: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
  hint: string | null;
  onBack: () => void;
  nodeKinds: NodeKindSchema[];
  onAddNode: (kind: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"opus" | "nodes" | null>("opus");
  const [panelWidth, setPanelWidth] = useState(340);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const toggleTab = (tab: "opus" | "nodes") =>
    setActiveTab((prev) => (prev === tab ? null : tab));

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: panelWidth };
    setResizing(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [panelWidth]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const next = dragRef.current.startW + (e.clientX - dragRef.current.startX);
    setPanelWidth(Math.max(180, Math.min(600, next)));
  }, []);

  const onResizePointerUp = useCallback(() => {
    dragRef.current = null;
    setResizing(false);
  }, []);

  const expanded = activeTab != null;

  return (
    <div className="sym-sidebar">
      {/* Expandable panel (left of rail) — always rendered for animation */}
      <div
        className={`sym-sidebar-panel${expanded ? "" : " sym-sidebar-panel--collapsed"}${resizing ? " sym-sidebar-panel--resizing" : ""}`}
        style={{ width: expanded ? panelWidth : 0 }}
      >
        <div className="sym-sidebar-panel-head">
          <EcliaLogo size="md" onClick={onBack} />
          <span className="sym-sidebar-panel-title">
            {activeTab === "opus" ? "Opus" : "Nodes"}
          </span>
          <ThemeModeSwitch compact />
        </div>

        <div className="sym-sidebar-body">
          {activeTab === "opus" ? (
            <>
              {activeName != null && (
                <div className="sym-flow-name-wrap">
                  <input
                    className="sym-flow-name-input"
                    value={activeName}
                    onChange={(e) => onNameChange(e.target.value)}
                    aria-label="Opus name"
                  />
                </div>
              )}

              <div className="sym-list-items">
                {opusList.length === 0 && (
                  <div className="sym-list-empty">No opus yet</div>
                )}

                {opusList.map((f) => (
                  <div
                    key={f.id}
                    className={`sym-list-item${f.id === activeId ? " sym-list-item--active" : ""}`}
                    onClick={() => onSelect(f.id)}
                  >
                    <div className="sym-list-item-top">
                      <span className="sym-list-item-name">{f.name}</span>
                      <span className={`sym-status sym-status--${f.status}`}>{f.status}</span>
                    </div>
                    <div className="sym-list-item-actions">
                      <label className="sym-toggle-label" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          onChange={(e) => onToggleEnabled(f.id, e.target.checked)}
                        />
                        <span>On</span>
                      </label>
                      <button
                        className="btn subtle"
                        style={{ padding: "2px 7px", fontSize: 10, color: "var(--danger)", borderRadius: 8 }}
                        onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${f.name}"?`)) onDelete(f.id); }}
                      >
                        Del
                      </button>
                    </div>
                  </div>
                ))}

                <button className="btn sym-new-btn" onClick={onCreate}>
                  + New Opus
                </button>
              </div>
            </>
          ) : activeTab === "nodes" ? (
            <NodeListWithPreview nodeKinds={nodeKinds} onAddNode={onAddNode} />
          ) : null}
        </div>

        {(dirty || hint || activeRunning) && (
          <div className="sym-sidebar-foot">
            {dirty ? (
              <div className="sym-foot-row">
                <button className="btn btn-save sym-save-btn" onClick={onSave}>Save</button>
                <button className="btn btn-discard sym-discard-btn" onClick={onDiscard}>Discard</button>
              </div>
            ) : hint ? (
              <>
                <button className="btn btn-save sym-reload-btn" onClick={onReload}>Reload</button>
                <span className="sym-hint-text">{hint}</span>
              </>
            ) : activeRunning ? (
              <button className="btn btn-save sym-reload-btn" onClick={onReload}>Reload</button>
            ) : null}
          </div>
        )}

        {/* Resize handle */}
        <div
          className="sym-sidebar-resize"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
      </div>

      {/* Activity rail — always visible, right edge */}
      <div className="sym-sidebar-rail">
        <button
          className={`sym-rail-btn${activeTab === "opus" ? " sym-rail-btn--active" : ""}`}
          onClick={() => toggleTab("opus")}
          title="Opus"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="2" width="14" height="16" rx="2" />
            <line x1="7" y1="6" x2="13" y2="6" />
            <line x1="7" y1="10" x2="13" y2="10" />
            <line x1="7" y1="14" x2="10" y2="14" />
          </svg>
        </button>

        <button
          className={`sym-rail-btn${activeTab === "nodes" ? " sym-rail-btn--active" : ""}`}
          onClick={() => toggleTab("nodes")}
          title="Nodes"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="7" height="7" rx="1.5" />
            <rect x="11" y="2" width="7" height="7" rx="1.5" />
            <rect x="2" y="11" width="7" height="7" rx="1.5" />
            <rect x="11" y="11" width="7" height="7" rx="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Node list with hover preview ─────────────────────────

const ROLE_ORDER: NodeRole[] = ["source", "process", "action", "gate"];

function NodeListWithPreview({ nodeKinds, onAddNode }: { nodeKinds: NodeKindSchema[]; onAddNode: (kind: string) => void }) {
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ schema: NodeKindSchema; top: number; left: number } | null>(null);

  const onEnter = useCallback((k: NodeKindSchema, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sidebar = (e.currentTarget as HTMLElement).closest(".sym-sidebar");
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : rect.right;
    setPreview({ schema: k, top: rect.top, left: sidebarRight + 10 });
  }, []);

  const onLeave = useCallback(() => setPreview(null), []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? nodeKinds.filter((k) => k.label.toLowerCase().includes(q) || k.kind.toLowerCase().includes(q)) : nodeKinds;
  }, [nodeKinds, search]);

  const grouped = useMemo(() => {
    const map = new Map<NodeRole, NodeKindSchema[]>();
    for (const role of ROLE_ORDER) map.set(role, []);
    for (const k of filtered) (map.get(k.role) ?? []).push(k);
    return map;
  }, [filtered]);

  return (
    <>
      <div className="sym-node-search-wrap">
        <input
          className="sym-node-search"
          placeholder="Search nodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="sym-node-list">
        {ROLE_ORDER.map((role) => {
          const items = grouped.get(role);
          if (!items || items.length === 0) return null;
          return (
            <div key={role} className="sym-node-group">
              <div className={`sym-node-group-label sym-node-role--${role}`}>{roleLabel(role)}</div>
              {items.map((k) => (
                <button
                  key={k.kind}
                  className={`sym-node-list-item sym-node-list-item--${k.role}`}
                  onClick={() => onAddNode(k.kind)}
                  onMouseEnter={(e) => onEnter(k, e)}
                  onMouseLeave={onLeave}
                >
                  <div className="sym-node-list-info">
                    <span className="sym-node-list-label">{k.label}</span>
                    {k.description && <span className="sym-node-list-desc">{k.description}</span>}
                  </div>
                </button>
              ))}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="sym-list-empty">{search ? "No matches" : "No node types available"}</div>
        )}
      </div>
      {preview && <NodePreview schema={preview.schema} top={preview.top} left={preview.left} />}
    </>
  );
}

function NodePreview({ schema, top, left }: { schema: NodeKindSchema; top: number; left: number }) {
  const connectableFields = schema.configSchema.filter((f) => f.connectable);

  return (
    <div className="sym-node-preview" style={{ top, left }}>
      <div className="sym-node">
        <div className="sym-node-header">
          <span className={`sym-node-role sym-node-role--${schema.role}`}>{roleLabel(schema.role)}</span>
          <span className="sym-node-label">{schema.label}</span>
        </div>
        {(schema.inputPorts.length > 0 || schema.outputPorts.length > 0 || connectableFields.length > 0) && (
          <div className="sym-node-ports">
            {schema.inputPorts.map((p) => (
              <div key={p.key} className="sym-node-port sym-node-port--in">
                <span className="sym-preview-dot" style={{ background: PORT_COLORS[p.type] ?? PORT_COLORS.any }} />
                <span className="sym-port-label">{p.label}</span>
              </div>
            ))}
            {connectableFields.map((f) => {
              const pt: PortType = (CFG_TO_PORT as Record<string, PortType>)[f.type] ?? "any";
              return (
                <div key={`cfg_${f.key}`} className="sym-node-port sym-node-port--in">
                  <span className="sym-preview-dot" style={{ background: PORT_COLORS[pt] ?? PORT_COLORS.any }} />
                  <span className="sym-port-label sym-port-label--cfg">{f.label}</span>
                </div>
              );
            })}
            {schema.outputPorts.map((p) => (
              <div key={p.key} className="sym-node-port sym-node-port--out">
                <span className="sym-port-label">{p.label}</span>
                <span className="sym-preview-dot" style={{ background: PORT_COLORS[p.type] ?? PORT_COLORS.any }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
