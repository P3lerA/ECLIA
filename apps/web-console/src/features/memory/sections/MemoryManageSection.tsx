import React from "react";

import { MemoryItemDisclosure } from "../components/MemoryItemDisclosure";
import type { MemoryManageItem } from "../memoryTypes";

export type MemoryManageSectionProps = {
  manageQuery: string;
  setManageQuery: React.Dispatch<React.SetStateAction<string>>;
  manageLoading: boolean;
  manageError: string | null;
  filteredManageItems: MemoryManageItem[];
  onAdd: () => void;
  adding: boolean;
  onItemChange: (next: MemoryManageItem) => void;
  onItemDelete: (id: string) => void;
};

export function MemoryManageSection(props: MemoryManageSectionProps) {
  const {
    manageQuery,
    setManageQuery,
    manageLoading,
    manageError,
    filteredManageItems,
    onAdd,
    adding,
    onItemChange,
    onItemDelete
  } = props;

  return (
    <>
      <div className="card">
        <div className="card-title">Memories</div>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1 }}>
            <div className="field-label">Search</div>
            <input
              className="select"
              value={manageQuery}
              onChange={(e) => setManageQuery(e.target.value)}
              placeholder="Filter by substring…"
              spellCheck={false}
              disabled={manageLoading}
            />
          </label>

          <button type="button" className="btn subtle" onClick={onAdd} disabled={manageLoading || adding}>
            {adding ? "…" : "Add"}
          </button>
        </div>

        {manageError ? (
          <div className="devNoteText" style={{ color: "var(--danger)", marginTop: 10 }}>
            {manageError}
          </div>
        ) : null}

        <div style={{ marginTop: 10 }}>
          {filteredManageItems.length === 0 && !manageLoading ? (
            <div className="devNoteText muted">No memories yet. Add one above.</div>
          ) : null}

          {filteredManageItems.map((item) => (
            <MemoryItemDisclosure
              key={item.id}
              item={item}
              onChange={onItemChange}
              onDelete={onItemDelete}
              disabled={manageLoading}
            />
          ))}
        </div>
      </div>

      <div className="devNoteText muted">
        Memories are stored in <code>.eclia/memory/profile.json</code>.
      </div>
    </>
  );
}
