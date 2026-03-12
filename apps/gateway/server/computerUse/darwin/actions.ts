/**
 * Action executor for macOS.
 *
 * Translates model-returned computer_call actions into native input events
 * via `eclia-input`, a small Swift binary using CoreGraphics CGEvent.
 *
 * Supported action types (matching OpenAI Responses API computer_call schema):
 *   click, double_click, type, keypress, scroll, move, drag, wait, screenshot
 *
 * `screenshot` is a no-op — the loop always captures a screenshot after
 * every computer_call.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Path to the eclia-input binary (compiled Swift, ships in repo). */
const ECLIA_INPUT = path.join(import.meta.dirname, "native", "eclia-input");

/** Delay after each action to let the UI settle (ms). */
const DEFAULT_POST_ACTION_DELAY_MS = 300;

const MODIFIER_KEYS = new Set(["cmd", "ctrl", "alt", "shift"]);

export type ComputerAction =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "wheel" | "back" | "forward" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "keypress"; keys: string[] }
  | { type: "scroll"; x: number; y: number; scroll_x: number; scroll_y: number }
  | { type: "move"; x: number; y: number }
  | { type: "drag"; path: Array<{ x: number; y: number }> }
  | { type: "wait" }
  | { type: "screenshot" };

async function input(...args: string[]): Promise<void> {
  await execFileAsync(ECLIA_INPUT, args, { timeout: 10_000 });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Map OpenAI key names to eclia-input key names.
 * eclia-input accepts "cmd+c", "return", "shift+tab" style combos.
 */
function mapKey(key: string): string {
  const k = key.toLowerCase();
  const map: Record<string, string> = {
    enter: "return",
    meta: "cmd",
    super: "cmd",
    command: "cmd",
    control: "ctrl",
    option: "alt",
    arrowup: "up",
    arrowdown: "down",
    arrowleft: "left",
    arrowright: "right",
  };
  return map[k] ?? k;
}

/**
 * Execute a single computer action.
 */
export async function executeAction(
  action: ComputerAction,
  postDelayMs: number = DEFAULT_POST_ACTION_DELAY_MS
): Promise<void> {
  switch (action.type) {
    case "click": {
      const args = [
        "click",
        String(Math.round(action.x)),
        String(Math.round(action.y))
      ];
      // "wheel" = middle click; "back"/"forward" = mouse button 4/5.
      if (action.button === "right") args.push("right");
      else if (action.button === "wheel") args.push("middle");
      else if (action.button === "back") args.push("back");
      else if (action.button === "forward") args.push("forward");
      await input(...args);
      break;
    }

    case "double_click": {
      await input(
        "doubleclick",
        String(Math.round(action.x)),
        String(Math.round(action.y))
      );
      break;
    }

    case "type": {
      const text = action.text ?? "";
      // Long text or text with newlines → pipe via stdin to avoid arg-length
      // limits and to preserve newlines (args.joined(separator:" ") loses them).
      // Timeout scales with text length (~8ms per char in Swift + overhead).
      const timeoutMs = Math.max(10_000, text.length * 12 + 5_000);
      await new Promise<void>((resolve, reject) => {
        const proc = execFile(ECLIA_INPUT, ["type", "-"], { timeout: timeoutMs }, (err) => {
          if (err) reject(err); else resolve();
        });
        proc.stdin!.end(text);
      });
      break;
    }

    case "keypress": {
      const keys = (action.keys ?? []).map(mapKey);
      if (keys.length === 0) break;
      // eclia-input accepts "cmd+c" style combo as a single argument.
      await input("keypress", keys.join("+"));
      break;
    }

    case "scroll": {
      // OpenAI convention: positive scroll_y = scroll down.
      // eclia-input passes dy/dx directly to CGEvent (positive = scroll up).
      // So we negate.
      const dy = -Math.round(action.scroll_y ?? 0);
      const dx = -Math.round(action.scroll_x ?? 0);
      await input(
        "scroll",
        String(Math.round(action.x)),
        String(Math.round(action.y)),
        String(dy),
        String(dx)
      );
      break;
    }

    case "move": {
      await input(
        "move",
        String(Math.round(action.x)),
        String(Math.round(action.y))
      );
      break;
    }

    case "drag": {
      const pts = action.path ?? [];
      if (pts.length < 2) break;
      // Pass all waypoints to eclia-input as x1 y1 x2 y2 [x3 y3 ...].
      const coordArgs = pts.flatMap(p => [
        String(Math.round(p.x)),
        String(Math.round(p.y))
      ]);
      await input("drag", ...coordArgs);
      break;
    }

    case "wait": {
      await sleep(2000);
      return; // Skip post-delay.
    }

    case "screenshot": {
      // No-op — the loop captures a screenshot after every computer_call.
      break;
    }

    default:
      console.warn(`[computerUse] Unknown action type: ${(action as any).type}`);
      break;
  }

  // Post-action delay to let UI settle.
  if (postDelayMs > 0) await sleep(postDelayMs);
}

/**
 * Extra settling time (ms) inserted after a `keypress` that is followed by a
 * `type` action. Shortcuts like CMD+SPACE (Spotlight) or CMD+L (address bar)
 * trigger UI transitions that need more time than a normal post-action delay
 * before the target input field is ready to receive text.
 */
const KEYPRESS_BEFORE_TYPE_EXTRA_DELAY_MS = 800;
const SHORTCUT_BEFORE_TYPE_EXTRA_DELAY_MS = 1_200;

function getKeypressBeforeTypeDelay(action: Extract<ComputerAction, { type: "keypress" }>): number {
  const keys = (action.keys ?? []).map(mapKey);
  const hasModifier = keys.some((key) => MODIFIER_KEYS.has(key));
  if (!hasModifier) return KEYPRESS_BEFORE_TYPE_EXTRA_DELAY_MS;

  const nonModifiers = keys.filter((key) => !MODIFIER_KEYS.has(key));
  const primary = nonModifiers[0] ?? "";

  // Focus/select shortcuts need more time before unicode typing starts.
  if (primary === "a" || primary === "l" || primary === "space" || primary === "tab") {
    return SHORTCUT_BEFORE_TYPE_EXTRA_DELAY_MS;
  }

  return KEYPRESS_BEFORE_TYPE_EXTRA_DELAY_MS;
}

/**
 * Execute a batch of actions sequentially.
 */
export async function executeActions(
  actions: ComputerAction[],
  postDelayMs?: number
): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    await executeAction(action, postDelayMs);

    // If a keypress is immediately followed by a type action, add extra delay
    // to let the UI settle (Spotlight open, address bar focus, etc.).
    if (
      action.type === "keypress" &&
      i + 1 < actions.length &&
      actions[i + 1].type === "type"
    ) {
      await sleep(getKeypressBeforeTypeDelay(action));
    }
  }
}
