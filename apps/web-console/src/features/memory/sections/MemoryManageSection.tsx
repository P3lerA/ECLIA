import React from "react";

import { MemoryItemDisclosure } from "../components/MemoryItemDisclosure";
import type { MemoryManageItem } from "../memoryTypes";

export type MemoryManageSectionProps = {
  newRaw: string;
  setNewRaw: React.Dispatch<React.SetStateAction<string>>;
  newStrength: string;
  setNewStrength: React.Dispatch<React.SetStateAction<string>>;
  newError: string | null;
  newSaving: boolean;
  onCreateNew: () => void;

  manageQuery: string;
  setManageQuery: React.Dispatch<React.SetStateAction<string>>;
  manageLoading: boolean;
  manageError: string | null;
  filteredManageItems: MemoryManageItem[];
  onReloadManage: () => void;
  onItemChange: (next: MemoryManageItem) => void;
  onItemDelete: (id: string) => void;
};

export function MemoryManageSection(props: MemoryManageSectionProps) {
  const {
    newRaw,
    setNewRaw,
    newStrength,
    setNewStrength,
    newError,
    newSaving,
    onCreateNew,
    manageQuery,
    setManageQuery,
    manageLoading,
    manageError,
    filteredManageItems,
    onReloadManage,
    onItemChange,
    onItemDelete
  } = props;

  return (
    <>
      <div className="card">
        <div className="card-title">Add memory</div>

        {newError ? (
          <div className="devNoteText" style={{ color: "var(--danger)", marginBottom: 10 }}>
            {newError}
          </div>
        ) : null}

        <div className="grid2">
          <label className="field">
            <div className="field-label">Strength (‖r‖)</div>
            <input
              className="select"
              value={newStrength}
              onChange={(e) => setNewStrength(e.target.value)}
              inputMode="decimal"
              spellCheck={false}
              disabled={newSaving}
            />
            <div className="field-sub">Initial relation strength.</div>
          </label>

          <div className="field" aria-hidden="true" />
        </div>

        <label className="field" style={{ marginTop: 10 }}>
          <div className="field-label">Raw</div>
          <textarea
            className="select"
            value={newRaw}
            onChange={(e) => setNewRaw(e.target.value)}
            rows={4}
            spellCheck={false}
            disabled={newSaving}
            placeholder="Write a fact about the user (as raw text)…"
          />
        </label>

        <div className="profileActions" style={{ marginTop: 10, gap: 8 }}>
          <button type="button" className="btn subtle" onClick={onCreateNew} disabled={newSaving}>
            {newSaving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Memories</div>

        <div className="grid2">
          <label className="field">
            <div className="field-label">Search</div>
            <input
              className="select"
              value={manageQuery}
              onChange={(e) => setManageQuery(e.target.value)}
              placeholder="Filter by substring…"
              spellCheck={false}
              disabled={manageLoading}
            />
            <div className="field-sub">Matches against raw text + id (client-side filter).</div>
          </label>

          <div className="field">
            <div className="field-label">&nbsp;</div>
            <button type="button" className="btn subtle" onClick={onReloadManage} disabled={manageLoading}>
              {manageLoading ? "Loading…" : "Reload"}
            </button>
          </div>
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
        Note: memories are persisted on disk (per embeddings model) by the memory service.
      </div>
    </>
  );
}
