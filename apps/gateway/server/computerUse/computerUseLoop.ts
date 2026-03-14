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
    maxIterations, actionDelayMs,
    signal, emit, isCancelled, debug, sessionDir,
    store, sessionId
  } = args;

  if (platform() !== "darwin" && platform() !== "win32") {
    throw new Error(`Computer use is not supported on ${platform()}`);
  }

  // Best-effort persistence: fire-and-forget, but chained to preserve record ordering.
  let lastPersist = Promise.resolve();
  const persist = store && sessionId
    ? (step: Parameters<SessionStore["appendComputerUseStep"]>[1]) => {
        lastPersist = lastPersist.then(() => store.appendComputerUseStep(sessionId, step)).catch(() => { /* best-effort */ });
      }
    : null;

  let iterations = 0;
  let assistantText = "";
  let previousResponseId: string | undefined;

  const t0 = Date.now();
  const log = (msg: string) => console.log(`[computerUse] +${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`);

  // ── 1. Initial screenshot ──────────────────────────────────────
  log("capturing initial screenshot");
  emit("phase", { phase: "screenshot", ts: Date.now() });
  const initialScreenshot = await captureScreen();
  log(`screenshot ${initialScreenshot.width}×${initialScreenshot.height}`);

  // First turn: full input with user message + screenshot.
  let input: any[] = [
    {
      role: "user",
      content: [
        { type: "input_text", text: userText },
        {
          type: "input_image",
          image_url: `data:image/jpeg;base64,${initialScreenshot.base64}`
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

  try {
  while (iterations < maxIterations && !isCancelled()) {
    log(`iteration ${iterations + 1}/${maxIterations} — generating`);
    emit("phase", { phase: "generating", ts: Date.now() });

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
      log(`completed after ${iterations} iteration(s) — model returned text`);

      if (persist) persist({
        kind: "done",
        assistantText,
        stopReason: "completed",
        totalIterations: iterations
      });

      emit("assistant_end", {});

      return { assistantText, iterations, stopReason: "completed" };
    }

    // ── 2b. Execute computer actions ───────────────────────────
    const cc = turn.computerCall;
    const actions = cc.actions as ComputerAction[];

    const actionSummary = actions.map((a) => a.type).join(", ");
    log(`executing ${actions.length} action(s): ${actionSummary}`);
    emit("computer_action", { callId: cc.callId, actions });

    emit("phase", { phase: "executing", ts: Date.now() });

    await executeActions(actions, actionDelayMs);

    // ── 2c. Capture new screenshot ─────────────────────────────
    log("capturing screenshot");
    emit("phase", { phase: "screenshot", ts: Date.now() });
    const screenshot = await captureScreen();

    log(`screenshot ${screenshot.width}×${screenshot.height}`);
    emit("screenshot", { width: screenshot.width, height: screenshot.height });

    // Save this turn's screenshot.
    if (sessionDir) await persistScreenshot(sessionDir, iterations, screenshot);

    // Persist this iteration immediately (survives crashes).
    if (persist) persist({
      kind: "iteration",
      callId: cc.callId,
      actions: actions as Array<Record<string, any>>,
      assistantText,
      result: { ok: true, actionsExecuted: actions.length },
      pendingSafetyChecks: cc.pendingSafetyChecks?.length ? cc.pendingSafetyChecks : undefined
    });

    // ── 2d. Build next input ────────────────────────────────────
    // With previous_response_id the API already has prior context.
    // We only send the new computer_call_output.
    const callOutput: any = {
      type: "computer_call_output",
      call_id: cc.callId,
      output: {
        type: "computer_screenshot",
        image_url: `data:image/jpeg;base64,${screenshot.base64}`
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
  const stopReason = isCancelled() ? "cancelled" : "max_iterations";
  log(`loop ended: ${stopReason} after ${iterations} iteration(s)`);

  if (persist) persist({
    kind: "done",
    assistantText,
    stopReason,
    totalIterations: iterations
  });

  return { assistantText, iterations, stopReason };

  } finally {
    // Drain all in-flight persistence before returning or throwing,
    // so chat.ts error/turn records never land before iteration records.
    await lastPersist;
  }
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
    const file = path.join(dir, `${String(turnSeq).padStart(4, "0")}.jpg`);
    await fs.promises.writeFile(file, Buffer.from(screenshot.base64, "base64"));
  } catch (e) {
    // Best-effort — don't let screenshot persistence break the loop.
    console.warn(`[computerUse] Failed to persist screenshot: ${e}`);
  }
}
