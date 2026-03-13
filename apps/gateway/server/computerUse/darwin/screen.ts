/**
 * Screen capture for macOS.
 *
 * Delegates entirely to `eclia-input screenshot`, which uses
 * CGWindowListCreateImage at nominal (logical) resolution, JPEG-compresses
 * in memory, and outputs base64 to stdout. Zero disk IO.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Path to the eclia-input binary. */
const ECLIA_INPUT = path.join(import.meta.dirname, "native", "eclia-input");

export type ScreenshotResult = {
  /** JPEG image encoded as base64. */
  base64: string;
  /** Width of the image sent to model (possibly downscaled). */
  width: number;
  /** Height of the image sent to model (possibly downscaled). */
  height: number;
  /** Logical screen width (for coordinate mapping). */
  logicalWidth: number;
  /** Logical screen height (for coordinate mapping). */
  logicalHeight: number;
};

/** Cached logical screen dimensions (populated on first screenshot). */
let cachedScreenSize: { width: number; height: number } | null = null;

/**
 * Query the main display's logical resolution via `eclia-input screensize`.
 * The result is cached for the process lifetime.
 */
export async function getScreenLogicalSize(): Promise<{ width: number; height: number }> {
  if (cachedScreenSize) return cachedScreenSize;
  try {
    const { stdout } = await execFileAsync(ECLIA_INPUT, ["screensize"], { timeout: 5_000 });
    const [w, h] = stdout.trim().split(/\s+/).map(Number);
    if (w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) {
      cachedScreenSize = { width: w, height: h };
      return cachedScreenSize;
    }
  } catch (e) {
    console.warn(`[computerUse] Failed to query screen size: ${e}`);
  }
  // Fallback — common MacBook logical resolution.
  return { width: 1440, height: 900 };
}

/** Max long edge for screenshots sent to model. 0 = no cap. */
const MAX_SCREENSHOT_LONG_EDGE = 1600;

/**
 * Capture the primary display and return a base64-encoded JPEG.
 */
export async function captureScreen(): Promise<ScreenshotResult> {
  const args = ["screenshot"];
  if (MAX_SCREENSHOT_LONG_EDGE > 0) args.push(String(MAX_SCREENSHOT_LONG_EDGE));

  const { stdout } = await execFileAsync(ECLIA_INPUT, args, {
    timeout: 10_000,
    maxBuffer: 10 * 1024 * 1024 // 10 MB — base64 JPEG can be large on high-res displays
  });

  const newlineIdx = stdout.indexOf("\n");
  if (newlineIdx === -1) throw new Error("Invalid screenshot output from eclia-input");

  const header = stdout.slice(0, newlineIdx).trim();
  const parts = header.split(/\s+/).map(Number);
  const base64 = stdout.slice(newlineIdx + 1).trim();

  // New format: "outW outH logicalW logicalH", fallback to old "w h"
  const w = parts[0], h = parts[1];
  const logicalW = parts.length >= 4 ? parts[2] : w;
  const logicalH = parts.length >= 4 ? parts[3] : h;

  if (!(w > 0) || !(h > 0) || !base64) {
    throw new Error("Invalid screenshot output from eclia-input");
  }

  // Keep screen size cache in sync.
  cachedScreenSize = { width: logicalW, height: logicalH };

  return { base64, width: w, height: h, logicalWidth: logicalW, logicalHeight: logicalH };
}
