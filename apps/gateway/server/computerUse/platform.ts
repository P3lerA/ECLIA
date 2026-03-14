/**
 * Platform-specific computer use re-exports.
 *
 * Selects darwin/ or win32/ implementations based on process.platform.
 * Both expose identical interfaces: captureScreen, getScreenLogicalSize,
 * executeAction, executeActions, ComputerAction, ScreenshotResult.
 */

// Dynamic import isn't practical here (async + re-export), so we use
// conditional re-export via a single platform gate. TypeScript compiles
// both, but only the matching platform's native binary needs to exist.

import type { ScreenshotResult as DarwinScreenshotResult } from "./darwin/screen.js";
import type { ScreenshotResult as Win32ScreenshotResult } from "./win32/screen.js";
import type { ComputerAction as DarwinComputerAction } from "./darwin/actions.js";
import type { ComputerAction as Win32ComputerAction } from "./win32/actions.js";

export type ScreenshotResult = DarwinScreenshotResult | Win32ScreenshotResult;
export type ComputerAction = DarwinComputerAction | Win32ComputerAction;

type PlatformModule = {
  captureScreen: () => Promise<ScreenshotResult>;
  getScreenLogicalSize: () => Promise<{ width: number; height: number }>;
  executeAction: (action: any, postDelayMs?: number) => Promise<void>;
  executeActions: (actions: any[], postDelayMs?: number) => Promise<void>;
};

let _platform: PlatformModule | null = null;

/** Last known scale factor from screenshot space → logical screen space. */
let _coordScaleX = 1;
let _coordScaleY = 1;
/** Last known logical screen dimensions for clamping. */
let _logicalW = 0;
let _logicalH = 0;

async function getPlatform(): Promise<PlatformModule> {
  if (_platform) return _platform;
  if (process.platform === "win32") {
    const screen = await import("./win32/screen.js");
    const actions = await import("./win32/actions.js");
    _platform = {
      captureScreen: screen.captureScreen,
      getScreenLogicalSize: screen.getScreenLogicalSize,
      executeAction: actions.executeAction,
      executeActions: actions.executeActions,
    };
  } else {
    // Default to darwin (also covers linux in the future if needed).
    const screen = await import("./darwin/screen.js");
    const actions = await import("./darwin/actions.js");
    _platform = {
      captureScreen: screen.captureScreen,
      getScreenLogicalSize: screen.getScreenLogicalSize,
      executeAction: actions.executeAction,
      executeActions: actions.executeActions,
    };
  }
  return _platform;
}

export async function captureScreen() {
  const result = await (await getPlatform()).captureScreen();
  // Update coordinate scale if screenshot was downscaled.
  const logW = result.logicalWidth ?? result.width;
  const logH = result.logicalHeight ?? result.height;
  _coordScaleX = logW / result.width;
  _coordScaleY = logH / result.height;
  _logicalW = logW;
  _logicalH = logH;
  if (_coordScaleX !== 1 || _coordScaleY !== 1) {
    console.log(`[computerUse] coord scale: ${result.width}×${result.height} → ${logW}×${logH} (×${_coordScaleX.toFixed(3)}, ×${_coordScaleY.toFixed(3)})`);
  }
  return result;
}

export async function getScreenLogicalSize() {
  return (await getPlatform()).getScreenLogicalSize();
}

/**
 * Scale model coordinates (in screenshot space) to logical screen coordinates.
 */
function clampCoords(x: number, y: number): { x: number; y: number } {
  if (_logicalW > 0) x = Math.max(0, Math.min(x, _logicalW - 1));
  if (_logicalH > 0) y = Math.max(0, Math.min(y, _logicalH - 1));
  return { x, y };
}

function scaleAction(action: ComputerAction): ComputerAction {
  if (_coordScaleX === 1 && _coordScaleY === 1) return action;
  const a = { ...action } as any;
  if ("x" in a && typeof a.x === "number") {
    const origX = a.x, origY = a.y;
    const scaled = clampCoords(
      Math.round(a.x * _coordScaleX),
      Math.round((a.y ?? 0) * _coordScaleY)
    );
    a.x = scaled.x;
    a.y = scaled.y;
    console.log(`[computerUse] scale ${a.type}: (${origX},${origY}) → (${a.x},${a.y})`);
  }
  // scroll_x / scroll_y are notch counts, not pixel coordinates — do not scale
  if ("path" in a && Array.isArray(a.path)) {
    a.path = a.path.map((p: any) => clampCoords(
      Math.round(p.x * _coordScaleX),
      Math.round(p.y * _coordScaleY),
    ));
  }
  return a;
}

export async function executeAction(action: ComputerAction, postDelayMs?: number) {
  return (await getPlatform()).executeAction(scaleAction(action), postDelayMs);
}

export async function executeActions(actions: ComputerAction[], postDelayMs?: number) {
  return (await getPlatform()).executeActions(actions.map(scaleAction), postDelayMs);
}
