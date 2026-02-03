import React from "react";
import { useReducedMotion } from "./useReducedMotion";

export type PresenceMotion = "enter" | "exit";

/**
 * Keeps a component mounted long enough to play an exit animation.
 * The returned `motion` value is intended to be wired to `data-motion`.
 */
export function usePresence(open: boolean, opts?: { exitMs?: number }) {
  const reduced = useReducedMotion();
  const exitMs = reduced ? 0 : opts?.exitMs ?? 220;

  const [present, setPresent] = React.useState<boolean>(open);
  const [motion, setMotion] = React.useState<PresenceMotion>(open ? "enter" : "exit");

  React.useEffect(() => {
    if (open) {
      setPresent(true);
      setMotion("enter");
      return;
    }

    if (!present) return;

    setMotion("exit");
    if (exitMs <= 0) {
      setPresent(false);
      return;
    }

    const t = window.setTimeout(() => setPresent(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, present, exitMs]);

  return { present, motion, reduced } as const;
}
