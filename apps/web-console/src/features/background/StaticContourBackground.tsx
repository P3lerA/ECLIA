import React from "react";

/**
 * Static contour texture fallback (temporary)
 * - Currently uses an embedded SVG tile (CPU-rendered contours will come later).
 */
export function StaticContourBackground() {
  return <div className="bg-static" aria-hidden="true" />;
}
