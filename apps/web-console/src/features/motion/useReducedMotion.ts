import React from "react";

/**
 * Returns true if the user prefers reduced motion (OS/browser accessibility setting).
 * We use this to disable non-essential animations and stop ambient loops.
 */
export function useReducedMotion(): boolean {
  const get = () => {
    if (typeof window === "undefined") return false;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    return mq ? mq.matches : false;
  };

  const [reduced, setReduced] = React.useState<boolean>(get);

  React.useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;

    const onChange = () => setReduced(mq.matches);

    // Modern browsers
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }

    // Legacy Safari
    // eslint-disable-next-line deprecation/deprecation
    mq.addListener(onChange);
    // eslint-disable-next-line deprecation/deprecation
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}
