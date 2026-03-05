import http from "node:http";

import { loadEcliaConfig, readSystemMemoryConsolidateTemplate, renderSystemMemoryConsolidateTemplate } from "@eclia/config";

import { json, readJson } from "@eclia/gateway-client/utils";
import { asString, clampInt } from "@eclia/utils";
import type { GenesisState } from "../genesisState.js";
import type { MemoryDb } from "../memoryDb.js";
import { listFactsManage } from "../memoryDb.js";
import { transcriptRecordsToTimedMessages, groupTurns, chunkTurns, aggressiveTruncateForExtract, fetchGatewayTranscript, loadExtractToolConfig, buildExtractSystemPrompt } from "../extractCommon.js";
import { ensureGatewaySession, guessGatewayUrl, runGatewayChat, withGatewayAuth } from "@eclia/gateway-client";

async function fetchGatewaySessions(gatewayUrl: string): Promise<{ sessions: { id: string; title: string }[] }> {
  const url = `${gatewayUrl}/api/sessions`;
  const resp = await fetch(url, { headers: withGatewayAuth({}) });
  const j = (await resp.json().catch(() => null)) as any;
  if (!resp.ok || !j?.ok) throw new Error(`failed_to_list_sessions: ${j?.error ?? resp.status}`);
  const sessions = Array.isArray(j.sessions) ? (j.sessions as any[]) : [];
  return {
    sessions: sessions
      .map((s) => ({ id: String(s?.id ?? ""), title: String(s?.title ?? "") }))
      .filter((s) => s.id.trim().length > 0)
  };
}

function isInternalSessionId(id: string): boolean {
  return id.startsWith("memory-") || id.startsWith("listener-");
}

export async function handleGenesisRun(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: {
    genesis: GenesisState;
    db: MemoryDb;
  }
) {
  if (ctx.genesis.isRunning()) {
    return json(res, 409, { ok: false, error: "genesis_already_running", status: ctx.genesis.status() });
  }

  const body = await readJson(req);

  // Request-tunable knobs (kept minimal; most behavior is driven by config + templates).
  const sessionsLimit = clampInt((body as any)?.sessionsLimit, 1, 10_000, 10_000);
  const tail = clampInt((body as any)?.tail, 50, 50_000, 20_000);
  const turnsPerCallOverride = clampInt((body as any)?.turnsPerCall, 1, 64, 0);

  const model = typeof (body as any)?.model === "string" ? asString((body as any).model) : undefined;

  const started = ctx.genesis.start();

  // Run asynchronously so the API returns immediately.
  setTimeout(async () => {
    try {
      await runGenesisStage1Extract({
        genesis: ctx.genesis,
        sessionsLimit,
        tail,
        turnsPerCallOverride,
        model
      });

      await runGenesisStage2Consolidate({
        genesis: ctx.genesis,
        db: ctx.db,
        model
      });

      // Update fact count to reflect post-consolidation state.
      const finalFacts = await listFactsManage({ db: ctx.db, limit: 500 });
      ctx.genesis.setExtractedFacts(finalFacts.length);

      ctx.genesis.finishOk();
    } catch (err) {
      ctx.genesis.finishError(err);
    }
  }, 10);

  return json(res, 200, { ok: true, started });
}

export async function handleGenesisStatus(res: http.ServerResponse, ctx: { genesis: GenesisState }) {
  return json(res, 200, { ok: true, status: ctx.genesis.status() });
}

// ---------------------------------------------------------------------------
// Stage 1: Extract
// ---------------------------------------------------------------------------

async function runGenesisStage1Extract(args: {
  genesis: GenesisState;
  sessionsLimit: number;
  tail: number;
  turnsPerCallOverride: number;
  model?: string;
}) {
  const gatewayUrl = guessGatewayUrl();
  const { rootDir, config } = loadEcliaConfig(process.cwd());

  const { toolMessages, toolMaxCharsPerMsg, toolMaxTotalChars } = loadExtractToolConfig(config);

  const maxCharsPerMsg = 1200;
  const maxTotalChars = 10_000;
  const contextTokenLimit = 20000;

  const systemPrompt = buildExtractSystemPrompt(rootDir, config);

  const genesisSessionId = "memory-genesis-extract";
  try {
    await ensureGatewaySession(gatewayUrl, genesisSessionId, "Memory GENESIS Extract (internal)", { kind: "memory_genesis_extract" });
  } catch {
    // best-effort
  }

  const userText =
    "In the transcript above, extract any long-term user-relevant facts worth remembering. " +
    "Call the `memory` tool once per candidate (one candidate per call). " +
    "If there is nothing worth remembering in this chunk, reply with NONE.";

  args.genesis.setStage("stage1_extract");

  const { sessions } = await fetchGatewaySessions(gatewayUrl);
  const targets = sessions
    .filter((s) => s.id && !isInternalSessionId(s.id))
    .slice(0, Math.max(0, args.sessionsLimit));

  const turnsPerCallFromCfg = clampInt(((config as any)?.memory as any)?.genesis?.turns_per_call, 1, 64, 20);
  const turnsPerCall = args.turnsPerCallOverride > 0 ? args.turnsPerCallOverride : turnsPerCallFromCfg;

  for (const s of targets) {
    args.genesis.setCurrentSourceSession(s.id);
    const { transcript } = await fetchGatewayTranscript({ gatewayUrl, sessionId: s.id, tail: args.tail });
    const timed = transcriptRecordsToTimedMessages(transcript);
    const groups = groupTurns(timed.filter((m) => m.msg.role !== "system"));
    const chunks = chunkTurns(groups, turnsPerCall);

    for (const chunk of chunks) {
      const contextMessages = aggressiveTruncateForExtract(chunk, {
        maxCharsPerMsg,
        maxTotalChars,
        toolMessages,
        toolMaxCharsPerMsg,
        toolMaxTotalChars
      });

      // Skip empty chunks.
      if (!contextMessages.length) continue;

      await runGatewayChat({
        gatewayUrl,
        sessionId: genesisSessionId,
        userText,
        model: args.model,
        toolAccessMode: "full",
        streamMode: "final",
        enabledTools: ["memory"],
        includeHistory: false,
        messages: contextMessages as any,
        systemInstructionOverride: systemPrompt,
        skipMemoryRecall: true,
        contextTokenLimit
      });

      args.genesis.noteProcessedChunk(1);
    }

    args.genesis.noteProcessedSession(1);
  }
}

// ---------------------------------------------------------------------------
// Stage 2: Consolidate
// ---------------------------------------------------------------------------

async function runGenesisStage2Consolidate(args: {
  genesis: GenesisState;
  db: MemoryDb;
  model?: string;
}) {
  args.genesis.setStage("stage2_consolidate");

  const gatewayUrl = guessGatewayUrl();
  const { rootDir, config } = loadEcliaConfig(process.cwd());

  // Load all facts.
  const facts = await listFactsManage({ db: args.db, limit: 500 });
  if (facts.length < 2) return; // Nothing to consolidate.

  // Build the fact list for the user message (oldest first).
  const sorted = [...facts].reverse();
  const factLines = sorted.map((f) => `[${f.id}] ${f.raw}`).join("\n\n");
  const userText =
    "Below are all stored memory facts. Review them for duplicates, redundancies, " +
    "or facts that can be merged into a single entry. " +
    "Use `delete` to remove and `merge` to combine.\n\n" +
    factLines;

  // Build system prompt from consolidation template.
  const { text: tpl } = readSystemMemoryConsolidateTemplate(rootDir);
  const systemPrompt = renderSystemMemoryConsolidateTemplate(tpl, {
    userPreferredName: config?.persona?.user_preferred_name,
    assistantName: config?.persona?.assistant_name
  });

  const genesisSessionId = "memory-genesis-consolidate";
  try {
    await ensureGatewaySession(gatewayUrl, genesisSessionId, "Memory GENESIS Consolidate (internal)", { kind: "memory_genesis_consolidate" });
  } catch {
    // best-effort
  }

  await runGatewayChat({
    gatewayUrl,
    sessionId: genesisSessionId,
    userText,
    model: args.model,
    toolAccessMode: "full",
    streamMode: "final",
    enabledTools: ["memory"],
    includeHistory: false,
    systemInstructionOverride: systemPrompt,
    skipMemoryRecall: true,
    contextTokenLimit: 2000
  });
}
