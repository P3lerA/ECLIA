import React from "react";

export type UseStagedDraftArgs<TDraft> = {
  /**
   * Returns a "clean" draft for the current external state.
   *
   * The hook will pass the previously-known clean draft when you are currently dirty,
   * so you can preserve user input where appropriate without accidentally baking it
   * into the baseline.
   */
  getCleanDraft: (prev: TDraft | undefined) => TDraft;

  /** Returns true if the current draft has unsaved changes. */
  isDirty: (draft: TDraft) => boolean;

  /**
   * List of external dependencies that should refresh the clean baseline.
   * Example: "server config", "active session", "model", etc.
   */
  syncDeps?: React.DependencyList;

  /** Text shown when the user tries to navigate away with unsaved changes. */
  beforeUnloadMessage?: string;
};

/**
 * A small helper for screens that have:
 * - a local editable draft
 * - a notion of "dirty"
 * - discard/reset behavior
 * - optional syncing when upstream sources change
 */
export function useStagedDraft<TDraft>(args: UseStagedDraftArgs<TDraft>) {
  const { getCleanDraft, isDirty, syncDeps = [], beforeUnloadMessage = "You have unsaved changes." } = args;

  const [draft, setDraft] = React.useState<TDraft>(() => getCleanDraft(undefined));
  const dirty = isDirty(draft);

  // The last known clean snapshot (used for Discard).
  const cleanRef = React.useRef<TDraft>(draft);

  // A ref so event handlers don't capture stale dirty state.
  // Important detail: we intentionally update this ref *after* the baseline sync effect.
  // That way, when an upstream baseline arrives asynchronously (e.g. a config fetch),
  // the hook can treat the draft as "not dirty" for the purposes of hydration and
  // avoid locking the UI into a bogus "dirty" state.
  const dirtyRef = React.useRef<boolean>(dirty);

  // When external sources change, refresh the clean baseline. If not currently dirty,
  // also sync the active draft.
  //
  // Using a layout effect prevents a "flash" of default values in the first paint
  // after the upstream baseline becomes available.
  React.useLayoutEffect(() => {
    const prevForClean = dirtyRef.current ? cleanRef.current : draft;
    const nextClean = getCleanDraft(prevForClean);
    cleanRef.current = nextClean;

    if (!dirtyRef.current) {
      setDraft(nextClean);
    }

    // NOTE: The caller controls what changes should trigger refresh via syncDeps.
    // We intentionally do not depend on `draft` here to avoid resetting while typing.
  }, [getCleanDraft, ...syncDeps]);

  React.useEffect(() => {
    dirtyRef.current = dirty;
    if (!dirty) {
      cleanRef.current = draft;
    }
  }, [dirty, draft]);

  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = beforeUnloadMessage;
      return beforeUnloadMessage;
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [beforeUnloadMessage]);

  const discard = React.useCallback(() => {
    setDraft(cleanRef.current);
  }, []);

  return { draft, setDraft, dirty, discard };
}
