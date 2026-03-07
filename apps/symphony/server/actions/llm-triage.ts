import fs from "node:fs";
import path from "node:path";
import { runGatewayChat, ensureGatewaySession, guessGatewayUrl } from "@eclia/gateway-client";

import type { ActionStep, ActionStepFactory, ActionContext, ActionResult } from "../types.js";
// ─── Config ──────────────────────────────────────────────────

export interface LlmTriageConfig {
  /** Template with {{...}} placeholders for the triage prompt. */
  promptTemplate: string;
  /** User-defined criterion inserted into the template. */
  criterion: string;
  /** Gateway route key for the model (e.g. "openai_compat:default"). */
  model?: string;
  /** Origin for the gateway session (determines adapter for `send` tool). */
  origin?: any;
}

// ─── Factory ─────────────────────────────────────────────────

export const llmTriageActionFactory: ActionStepFactory = {
  kind: "llm-triage",
  label: "LLM Triage",
  configSchema: [
    { key: "criterion", label: "Criterion", type: "text", required: true, placeholder: "Notify me if the email is about…" },
    { key: "promptTemplate", label: "Prompt Template", type: "text", placeholder: "Leave blank for default" },
    { key: "model", label: "Model", type: "model" },
    { key: "notify_kind", label: "Notify via", type: "select", options: ["discord", "telegram"], default: "discord" },
    { key: "notify_channel", label: "Channel / Chat ID", type: "string", placeholder: "Discord channel ID or Telegram chat ID" }
  ],
  create(id, raw) {
    return new LlmTriageAction(id, coerceConfig(raw));
  }
};

// ─── Implementation ──────────────────────────────────────────

class LlmTriageAction implements ActionStep {
  readonly id: string;
  readonly kind = "llm-triage";

  private cfg: LlmTriageConfig;
  private sessionEnsured = false;

  constructor(id: string, cfg: LlmTriageConfig) {
    this.id = id;
    this.cfg = cfg;
  }

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const gatewayUrl = guessGatewayUrl();
    const sessionId = `symphony_${ctx.instrumentId}`;

    // Ensure a persistent session for audit trail (once per lifetime).
    if (!this.sessionEnsured) {
      try {
        await ensureGatewaySession(gatewayUrl, sessionId, `Symphony: ${ctx.instrumentId}`, this.cfg.origin);
        this.sessionEnsured = true;
      } catch (e: any) {
        ctx.log.warn("failed to ensure session:", String(e?.message ?? e));
      }
    }

    // Build prompt from template + signal data.
    const signal = ctx.signals[0]; // primary signal
    const prompt = renderPrompt(this.cfg.promptTemplate, this.cfg.criterion, signal?.data);

    const result = await runGatewayChat({
      gatewayUrl,
      sessionId,
      userText: prompt,
      model: this.cfg.model,
      toolAccessMode: "full",
      streamMode: "final",
      enabledTools: ["send"],
      includeHistory: false,
      skipMemoryRecall: true,
      origin: this.cfg.origin
    });

    const text = (result.text ?? "").trim();

    if (text === "IGNORE") {
      ctx.log.info("triage → IGNORE");
      return { ok: false, data: { outcome: "ignore" } };
    }

    ctx.log.info(`triage → proceed (text=${text.slice(0, 60)}…)`);
    return { ok: true, data: { outcome: "notified", text } };
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function renderPrompt(template: string, criterion: string, signalData: unknown): string {
  const data = (signalData && typeof signalData === "object" ? signalData : {}) as Record<string, unknown>;

  const vars: Record<string, string> = {
    criterion: criterion || "(empty rule; be conservative)",
    ...Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
    )
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function coerceOrigin(raw: Record<string, unknown>): unknown {
  if (raw.origin) return raw.origin;
  const kind = raw.notify_kind ? String(raw.notify_kind) : undefined;
  const channel = raw.notify_channel ? String(raw.notify_channel) : undefined;
  if (!kind || !channel) return undefined;
  return kind === "telegram"
    ? { kind: "telegram", chatId: channel }
    : { kind: "discord", channelId: channel };
}

function loadDefaultTemplate(): string {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const localPath = path.join(dir, "_triage_template.local.md");
  const basePath = path.join(dir, "_triage_template.md");
  try { if (fs.existsSync(localPath)) return fs.readFileSync(localPath, "utf-8"); } catch { /* fall through */ }
  try { return fs.readFileSync(basePath, "utf-8"); } catch { /* fall through */ }
  return "";
}

function coerceConfig(raw: Record<string, unknown>): LlmTriageConfig {
  return {
    promptTemplate: String(raw.promptTemplate ?? "") || loadDefaultTemplate(),
    criterion: String(raw.criterion ?? ""),
    model: raw.model ? String(raw.model) : undefined,
    origin: coerceOrigin(raw)
  };
}
