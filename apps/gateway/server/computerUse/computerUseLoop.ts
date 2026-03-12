/**
 * Computer use agent loop.
 *
 * This is a separate loop from the normal tool-calling loop (toolExecutor.ts).
 * It drives the screenshot → model → execute actions → screenshot cycle
 * specific to computer use.
 *
 * Lifecycle:
 *   1. Capture initial screenshot
 *   2. Send user instruction + screenshot to model (via Responses API)
 *   3. If model returns computer_call → execute actions → capture screenshot → go to 2
 *   4. If model returns text (no computer_call) → done
 *
 * Each turn's screenshot is persisted to disk. The transcript is written to the
 * session store in the same format as the chat loop (tool_calls / tool results).
 */

import fs from "node:fs";
import { platform } from "node:os";
import path from "node:path";

import { captureScreen, executeActions, type ScreenshotResult, type ComputerAction } from "./platform.js";
import { streamOpenAIResponsesTurn } from "../upstream/openaiResponses.js";
import type { UpstreamRequestDebugCapture } from "../upstream/provider.js";
import type { SessionStore } from "../sessionStore.js";

export type ComputerUseLoopArgs = {
  /** Responses API endpoint URL. */
  url: string;
  /** Auth + other headers for the upstream. */
  headers: Record<string, string>;
  /** Upstream model id (e.g. "gpt-5.4"). */
  model: string;
  /** System instruction for computer use mode. */
  instructions: string;
  /** The user's task description. */
  userText: string;

  /** Logical display dimensions declared to the model. */
  displayWidth: number;
  displayHeight: number;

  /** Max iterations before forced stop (safety limit). */
  maxIterations: number;
  /** Post-action delay in ms. */
  actionDelayMs: number;

  /** AbortSignal for cancellation. */
  signal: AbortSignal;

  /** Emit SSE events to the client. */
  emit: (event: string, data: any) => void;
  /** Check if client disconnected. */
  isCancelled: () => boolean;

  /** Debug capture config (optional). */
  debug?: UpstreamRequestDebugCapture;

  /** Session directory for screenshot persistence. */
  sessionDir?: string;

  /** Session store for transcript persistence. */
  store?: SessionStore;
  /** Session id (required if store is provided). */
  sessionId?: string;
};

export type ComputerUseLoopResult = {
  /** Final assistant text (if any). */
  assistantText: string;
  /** Number of computer_call iterations executed. */
  iterations: number;
  /** Why the loop stopped. */
  stopReason: "completed" | "max_iterations" | "cancelled" | "error";
};

export async function runComputerUseLoop(args: ComputerUseLoopArgs): Promise<ComputerUseLoopResult> {
  const {
    url, headers, model, instructions, userText,
    displayWidth, displayHeight,
    maxIterations, actionDelayMs,
    signal, emit, isCancelled, debug, sessionDir,
    store, sessionId
  } = args;

  if (platform() !== "darwin") {
    throw new Error(`Computer use is not supported on ${platform()}`);
  }

  // Transcript persistence helper (best-effort, never breaks the loop).
  const transcript = store && sessionId
    ? async (msg: Record<string, any>) => {
        try { await store.appendTranscript(sessionId, msg as any, Date.now()); } catch { /* best-effort */ }
      }
    : null;

  let iterations = 0;
  let assistantText = "";
  let previousResponseId: string | undefined;

  // ── 1. Initial screenshot ──────────────────────────────────────
  emit("phase", { phase: "screenshot" });
  const initialScreenshot = await captureScreen(displayWidth, displayHeight);

  // First turn: full input with user message + screenshot.
  let input: any[] = [
    {
      role: "user",
      content: [
        { type: "input_text", text: userText },
        {
          type: "input_image",
          image_url: `data:image/png;base64,${initialScreenshot.base64}`
        }
      ]
    }
  ];

  const tools: any[] = [
    { type: "computer" }
  ];

  // NOTE: The user message is already persisted by the chat route before calling us.

  // ── 2. Agent loop ──────────────────────────────────────────────
  let debugSeq = 0;

  while (iterations < maxIterations && !isCancelled()) {
    emit("phase", { phase: "generating" });

    const turn = await streamOpenAIResponsesTurn({
      url,
      headers,
      model,
      instructions,
      input,
      tools,
      truncation: "auto",
      previousResponseId,
      signal,
      onDelta: (text) => emit("delta", { text }),
      debug: debug ? { ...debug, seq: ++debugSeq } : undefined
    });

    assistantText = turn.assistantText;
    previousResponseId = turn.responseId;
    iterations++;

    // ── 2a. No computer_call → model is done ───────────────────
    if (!turn.computerCall) {
      // Persist final assistant text.
      if (transcript) await transcript({ role: "assistant", content: assistantText });

      emit("assistant_end", {});

      return { assistantText, iterations, stopReason: "completed" };
    }

    // ── 2b. Execute computer actions ───────────────────────────
    const cc = turn.computerCall;
    const actions = cc.actions as ComputerAction[];

    // Persist assistant message with computer_call as a tool_call.
    if (transcript) {
      await transcript({
        role: "assistant",
        content: assistantText,
        tool_calls: [{
          id: cc.callId,
          type: "function",
          function: {
            name: "computer",
            arguments: JSON.stringify({ actions })
          }
        }]
      });
    }

    emit("computer_action", { callId: cc.callId, actions });

    emit("phase", { phase: "executing" });

    await executeActions(actions, actionDelayMs);

    // ── 2c. Capture new screenshot ─────────────────────────────
    emit("phase", { phase: "screenshot" });
    const screenshot = await captureScreen(displayWidth, displayHeight);

    emit("screenshot", { width: screenshot.width, height: screenshot.height });

    // Save this turn's screenshot.
    if (sessionDir) await persistScreenshot(sessionDir, iterations, screenshot);

    // Persist tool result.
    if (transcript) {
      await transcript({
        role: "tool",
        tool_call_id: cc.callId,
        content: JSON.stringify({
          ok: true,
          iteration: iterations,
          actionsExecuted: actions.length,
          screenshotSaved: Boolean(sessionDir)
        })
      });
    }

    // ── 2d. Build next input ────────────────────────────────────
    // With previous_response_id the API already has prior context.
    // We only send the new computer_call_output.
    const callOutput: any = {
      type: "computer_call_output",
      call_id: cc.callId,
      output: {
        type: "computer_screenshot",
        image_url: `data:image/png;base64,${screenshot.base64}`
      }
    };

    if (cc.pendingSafetyChecks && cc.pendingSafetyChecks.length > 0) {
      callOutput.acknowledged_safety_checks = cc.pendingSafetyChecks.map((c) => ({
        id: c.id,
        code: c.code,
        message: c.message
      }));
    }

    input = [callOutput];
  }

  // ── 3. Loop exhausted or cancelled ─────────────────────────────
  if (transcript && assistantText) {
    await transcript({ role: "assistant", content: assistantText });
  }

  const stopReason = isCancelled() ? "cancelled" : "max_iterations";
  return { assistantText, iterations, stopReason };
}

// ── Screenshot persistence ──────────────────────────────────────────

async function persistScreenshot(
  sessionDir: string,
  turnSeq: number,
  screenshot: ScreenshotResult
): Promise<void> {
  try {
    const dir = path.join(sessionDir, "screenshots");
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${String(turnSeq).padStart(4, "0")}.png`);
    await fs.promises.writeFile(file, Buffer.from(screenshot.base64, "base64"));
  } catch (e) {
    // Best-effort — don't let screenshot persistence break the loop.
    console.warn(`[computerUse] Failed to persist screenshot: ${e}`);
  }
}
