import http from "node:http";

import { loadEcliaConfig } from "@eclia/config";

import { json, readJson, asString, clampInt } from "../httpUtils.js";
import { transcriptRecordsToTimedMessages, takeLastNTurns, aggressiveTruncateForExtract, fetchGatewayTranscript, loadExtractToolConfig, buildExtractSystemPrompt } from "../extractCommon.js";
import { ensureGatewaySession, guessGatewayUrl, runGatewayChat } from "../../../adapter/gateway.js";

export async function handleExtractRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJson(req);
  const sourceSessionId = asString((body as any)?.sourceSessionId);
  if (!sourceSessionId.trim()) return json(res, 400, { ok: false, error: "missing_sourceSessionId" });

  const nTurns = clampInt((body as any)?.turns, 1, 64, 10);
  const tail = clampInt((body as any)?.tail, 50, 2000, 400);

  const maxCharsPerMsg = clampInt((body as any)?.maxCharsPerMsg, 64, 10_000, 1200);
  const maxTotalChars = clampInt((body as any)?.maxTotalChars, 256, 200_000, 10_000);

  const gatewayUrl = guessGatewayUrl();

  // Load config early for defaults (tool-output truncation strategy).
  const { rootDir, config } = loadEcliaConfig(process.cwd());
  const { toolMessages, toolMaxCharsPerMsg, toolMaxTotalChars } = loadExtractToolConfig(config);

  // Fetch source transcript (from the gateway store), then prepare a role-structured context.
  const { transcript } = await fetchGatewayTranscript({ gatewayUrl, sessionId: sourceSessionId, tail });
  const allTimed = transcriptRecordsToTimedMessages(transcript);
  const lastTurns = takeLastNTurns(allTimed, nTurns);
  const contextMessages = aggressiveTruncateForExtract(lastTurns, {
    maxCharsPerMsg,
    maxTotalChars,
    toolMessages,
    toolMaxCharsPerMsg,
    toolMaxTotalChars
  });

  // Load system prompt template from _system_memory_extract.local.md (initialized at startup).
  const systemPrompt = buildExtractSystemPrompt(rootDir, config);

  // Ensure a stable internal session for audit/debug (doesn't affect context since includeHistory=false).
  const extractorSessionId = "memory-extract";
  try {
    await ensureGatewaySession(gatewayUrl, extractorSessionId, "Memory Extract (internal)", { kind: "memory_extract" });
  } catch {
    // best-effort
  }

  const userText =
    "In the transcript above, extract any long-term user-relevant facts worth remembering. " +
    "If needed, call the `memory` tool once per candidate (one candidate per call). " +
    "If there is nothing worth remembering, reply with NONE.";

  const { text: assistantText, meta } = await runGatewayChat({
    gatewayUrl,
    sessionId: extractorSessionId,
    userText,
    model: typeof (body as any)?.model === "string" ? String((body as any).model) : undefined,
    toolAccessMode: "full",
    streamMode: "final",
    enabledTools: ["memory"],
    includeHistory: false,
    messages: contextMessages as any,
    systemInstructionOverride: systemPrompt,
    skipMemoryRecall: true,
    // Extra aggressive: keep this small to avoid tool noise even if callers forget to strip.
    contextTokenLimit: clampInt((body as any)?.contextTokenLimit, 256, 50_000, 2000)
  });

  return json(res, 200, {
    ok: true,
    sourceSessionId,
    used: {
      turns: nTurns,
      tail,
      maxCharsPerMsg,
      maxTotalChars,
      toolMessages,
      toolMaxCharsPerMsg,
      toolMaxTotalChars,
      contextMessages: contextMessages.length
    },
    gateway: { sessionId: extractorSessionId, meta },
    assistantText
  });
}
