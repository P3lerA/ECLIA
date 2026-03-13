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
  captureScreen: () => Promise<DarwinScreenshotResult>;
  getScreenLogicalSize: () => Promise<{ width: number; height: number }>;
  executeAction: (action: any, postDelayMs?: number) => Promise<void>;
  executeActions: (actions: any[], postDelayMs?: number) => Promise<void>;
};

let _platform: PlatformModule | null = null;

/** Last known scale factor from screenshot space → logical screen space. */
let _coordScaleX = 1;
let _coordScaleY = 1;

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
  const logW = (result as any).logicalWidth ?? result.width;
  const logH = (result as any).logicalHeight ?? result.height;
  _coordScaleX = logW / result.width;
  _coordScaleY = logH / result.height;
  return result;
}

export async function getScreenLogicalSize() {
  return (await getPlatform()).getScreenLogicalSize();
}

/**
 * Scale model coordinates (in screenshot space) to logical screen coordinates.
 */
function scaleAction(action: ComputerAction): ComputerAction {
  if (_coordScaleX === 1 && _coordScaleY === 1) return action;
  const a = { ...action } as any;
  if ("x" in a && typeof a.x === "number") a.x = Math.round(a.x * _coordScaleX);
  if ("y" in a && typeof a.y === "number") a.y = Math.round(a.y * _coordScaleY);
  if ("scroll_x" in a && typeof a.scroll_x === "number") a.scroll_x = Math.round(a.scroll_x * _coordScaleX);
  if ("scroll_y" in a && typeof a.scroll_y === "number") a.scroll_y = Math.round(a.scroll_y * _coordScaleY);
  if ("path" in a && Array.isArray(a.path)) {
    a.path = a.path.map((p: any) => ({
      x: Math.round(p.x * _coordScaleX),
      y: Math.round(p.y * _coordScaleY),
    }));
  }
  return a;
}

export async function executeAction(action: ComputerAction, postDelayMs?: number) {
  return (await getPlatform()).executeAction(scaleAction(action), postDelayMs);
}

export async function executeActions(actions: ComputerAction[], postDelayMs?: number) {
  return (await getPlatform()).executeActions(actions.map(scaleAction), postDelayMs);
}
