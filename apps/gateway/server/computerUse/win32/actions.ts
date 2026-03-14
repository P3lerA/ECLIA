/**
 * Action executor for Windows.
 *
 * Same interface as darwin/actions.ts — translates model-returned computer_call
 * actions into native input events via `eclia-input.exe` (C# / Win32 SendInput).
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Path to the eclia-input binary (compiled C# Native AOT). */
const ECLIA_INPUT = path.join(import.meta.dirname, "native", "eclia-input.exe");

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
 * On Windows, cmd maps to win key via C# side, but we still normalize here.
 */
function mapKey(key: string): string {
  const k = key.toLowerCase();
  const map: Record<string, string> = {
    enter: "return",
    meta: "cmd",
    super: "cmd",
    win: "cmd",
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
      await input("keypress", keys.join("+"));
      break;
    }

    case "scroll": {
      // OpenAI convention: positive scroll_y = down, positive scroll_x = right.
      // Win32: WHEEL positive = up, HWHEEL positive = right.
      // Negate scroll_y (opposite), keep scroll_x (same direction).
      const dy = -Math.round(action.scroll_y ?? 0);
      const dx = Math.round(action.scroll_x ?? 0);
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
      const coordArgs = pts.flatMap(p => [
        String(Math.round(p.x)),
        String(Math.round(p.y))
      ]);
      await input("drag", ...coordArgs);
      break;
    }

    case "wait": {
      await sleep(2000);
      return;
    }

    case "screenshot": {
      break;
    }

    default:
      console.warn(`[computerUse] Unknown action type: ${(action as any).type}`);
      break;
  }

  if (postDelayMs > 0) await sleep(postDelayMs);
}

const KEYPRESS_BEFORE_TYPE_EXTRA_DELAY_MS = 800;
const SHORTCUT_BEFORE_TYPE_EXTRA_DELAY_MS = 1_200;

function getKeypressBeforeTypeDelay(action: Extract<ComputerAction, { type: "keypress" }>): number {
  const keys = (action.keys ?? []).map(mapKey);
  const hasModifier = keys.some((key) => MODIFIER_KEYS.has(key));
  if (!hasModifier) return KEYPRESS_BEFORE_TYPE_EXTRA_DELAY_MS;

  const nonModifiers = keys.filter((key) => !MODIFIER_KEYS.has(key));
  const primary = nonModifiers[0] ?? "";

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

    if (
      action.type === "keypress" &&
      i + 1 < actions.length &&
      actions[i + 1].type === "type"
    ) {
      await sleep(getKeypressBeforeTypeDelay(action));
    }
  }
}
