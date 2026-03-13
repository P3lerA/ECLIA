import React from "react";

import {
  createMemory,
  deleteMemoryItem,
  listMemories,
} from "../../../memory/memoryApi";
import type { MemoryManageItem } from "../../../memory/memoryTypes";
import type { SettingsDraft } from "../../settingsTypes";

import { MemorySettingsSection } from "../../../memory/sections/MemorySettingsSection";
import { MemoryManageSection } from "../../../memory/sections/MemoryManageSection";

export type MemorySectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  cfgLoading: boolean;
  cfgBaseAvailable: boolean;
  cfgError: string | null;
  dirtyDevMemory: boolean;
  memoryValid: boolean;
};

/**
 * Memory section for the Settings view.
 * Config state is managed by the parent SettingsView via shared draft.
 * Manage CRUD (list/create/delete memories) is self-contained.
 */
export function MemorySection(props: MemorySectionProps) {
  const {
    draft,
    setDraft,
    cfgLoading,
    cfgBaseAvailable,
    cfgError,
    dirtyDevMemory,
    memoryValid
  } = props;

  const devDisabled = cfgLoading || !cfgBaseAvailable;

  // --- Manage memories (self-contained) ---

  const [manageQuery, setManageQuery] = React.useState("");
  const [manageLoading, setManageLoading] = React.useState(false);
  const [manageError, setManageError] = React.useState<string | null>(null);
  const [manageItems, setManageItems] = React.useState<MemoryManageItem[]>([]);

  const [adding, setAdding] = React.useState(false);

  const loadedRef = React.useRef(false);

  const loadManage = React.useCallback(async () => {
    setManageLoading(true);
    setManageError(null);
    try {
      const rows = await listMemories({ q: "", limit: 500, offset: 0 });
      if (!rows) throw new Error("Memory service unreachable.");
      setManageItems(rows);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to load memories.";
      setManageError(msg);
      setManageItems([]);
    } finally {
      setManageLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadManage();
  }, [loadManage]);

  const filteredManageItems = React.useMemo(() => {
    const q = manageQuery.trim().toLowerCase();
    if (!q) return manageItems;
    return manageItems.filter((item) => item.raw.toLowerCase().includes(q) || item.id.toLowerCase().includes(q));
  }, [manageItems, manageQuery]);

  const addNew = async () => {
    if (adding) return;
    setAdding(true);
    setManageError(null);
    const created = await createMemory({ raw: "(new memory)" });
    if (!created) {
      setManageError("Failed to create memory (memory service unreachable).");
    } else {
      setManageItems((items) => [created, ...items]);
    }
    setAdding(false);
  };

  const updateInList = (next: MemoryManageItem) => {
    setManageItems((items) => items.map((item) => (item.id === next.id ? next : item)));
  };

  const deleteFromList = async (id: string) => {
    setManageLoading(true);
    setManageError(null);
    const ok = await deleteMemoryItem(id);
    if (!ok) {
      setManageError("Failed to delete memory (memory service unreachable).");
    } else {
      setManageItems((items) => items.filter((item) => item.id !== id));
    }
    setManageLoading(false);
  };

  return (
    <>
      <MemorySettingsSection
        draft={draft}
        setDraft={setDraft}
        cfgBaseAvailable={cfgBaseAvailable}
        cfgError={cfgError}
        devDisabled={devDisabled}
        dirty={dirtyDevMemory}
        valid={memoryValid}
      />

      <MemoryManageSection
        manageQuery={manageQuery}
        setManageQuery={setManageQuery}
        manageLoading={manageLoading}
        manageError={manageError}
        filteredManageItems={filteredManageItems}
        onAdd={() => void addNew()}
        adding={adding}
        onItemChange={updateInList}
        onItemDelete={(id) => void deleteFromList(id)}
      />
    </>
  );
}
