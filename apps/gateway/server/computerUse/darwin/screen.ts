/**
 * Screen capture for macOS.
 *
 * Uses the native `screencapture` CLI (ships with macOS, zero dependencies).
 * Returns a PNG screenshot as a base64 string.
 *
 * Retina handling:
 * - `screencapture` captures at physical pixel resolution (e.g. 2880×1800 on a Retina MBP).
 * - We use `sips` to resize to the logical resolution declared to the model so that
 *   coordinates returned by the model map 1:1 to screenshot pixels.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ScreenshotResult = {
  /** PNG image encoded as base64. */
  base64: string;
  /** Width in pixels (matches the logical resolution after resize). */
  width: number;
  /** Height in pixels (matches the logical resolution after resize). */
  height: number;
};

/**
 * Capture the primary display and return a base64-encoded PNG.
 *
 * @param logicalWidth  - The logical width declared to the model (e.g. 1440).
 * @param logicalHeight - The logical height declared to the model (e.g. 900).
 */
export async function captureScreen(logicalWidth: number, logicalHeight: number): Promise<ScreenshotResult> {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `eclia_screenshot_${Date.now()}.png`);

  try {
    // -x: no sound, -t png: format, -C: no cursor
    await execFileAsync("screencapture", ["-x", "-t", "png", "-C", tmpFile], {
      timeout: 10_000
    });

    // Resize to logical resolution so model coordinates map 1:1 to pixels.
    await execFileAsync("sips", [
      "--resampleWidth", String(logicalWidth),
      "--resampleHeight", String(logicalHeight),
      tmpFile
    ], { timeout: 10_000 });

    const buf = await fs.promises.readFile(tmpFile);
    const base64 = buf.toString("base64");

    return { base64, width: logicalWidth, height: logicalHeight };
  } finally {
    // Clean up temp file.
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}
