import { buildTruncatedContext } from "../context.js";
import crypto from "node:crypto";

import { dumpUpstreamRequestBody } from "../debug/upstreamRequests.js";

import { spawnCodexAppServerRpc } from "./codexAppServerRpc.js";
import { formatCodexError } from "./codexErrors.js";

import type { BuiltContext, ProviderTurnResult, ToolCall, ToolResult, UpstreamProvider } from "./provider.js";

type CodexSandboxVariant = "readOnly" | "workspaceWrite" | "dangerFullAccess" | "externalSandbox";
type CodexSandboxEnumStyle = "camel" | "kebab";

const CODEX_SANDBOX_KEBAB_MAP: Record<CodexSandboxVariant, string> = {
  readOnly: "read-only",
  workspaceWrite: "workspace-write",
  dangerFullAccess: "danger-full-access",
  externalSandbox: "external-sandbox"
};

function codexSandboxValue(style: CodexSandboxEnumStyle, v: CodexSandboxVariant): string {
  return style === "kebab" ? CODEX_SANDBOX_KEBAB_MAP[v] : v;
}

function inferCodexSandboxEnumStyleFromErrorMessage(msg: string): CodexSandboxEnumStyle | null {
  const s = String(msg ?? "");
  // Rust serde enum errors tend to look like:
  //   unknown variant `readOnly`, expected one of `read-only`, `workspace-write`, ...
  // Prefer looking at the *expected* list (not the unknown variant we sent).
  const expectedIdx = s.indexOf("expected");
  const haystack = expectedIdx >= 0 ? s.slice(expectedIdx) : s;
  if (/\b(read-only|workspace-write|danger-full-access|external-sandbox)\b/.test(haystack)) return "kebab";
  if (/\b(readOnly|workspaceWrite|dangerFullAccess|externalSandbox)\b/.test(haystack)) return "camel";
  return null;
}

function normalizeContent(content: any): string {
  if (typeof content === "string") return content;

  // OpenAI-style multi-part content
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (!p || typeof p !== "object") continue;
      if ((p as any).type === "text" && typeof (p as any).text === "string") {
        parts.push((p as any).text);
      }
    }
    return parts.join("");
  }

  // Last resort: stringify.
  try {
    return JSON.stringify(content);
  } catch {
    return String(content ?? "");
  }
}

const TOOL_CALLS_OPEN_TAG = "<ECLIA_TOOL_CALLS>";
const TOOL_CALLS_CLOSE_TAG = "</ECLIA_TOOL_CALLS>";

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "null";
  }
}


function stripMarkdownCodeFence(s: string): string {
  let t = String(s ?? "").trim();
  // Allow wrapping the JSON in a fenced code block:
  // ```json
  // {...}
  // ```
  const m = t.match(/^(```|~~~)[^\n]*\n([\s\S]*?)\n\1\s*$/);
  if (m) t = String(m[2] ?? "").trim();
  return t;
}

function extractJsonLikeSpan(s: string): string {
  const t = String(s ?? "").trim();
  // Best-effort fallback: grab the outermost {...} or [...] span.
  const firstObj = t.indexOf("{");
  const lastObj = t.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) return t.slice(firstObj, lastObj + 1).trim();

  const firstArr = t.indexOf("[");
  const lastArr = t.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) return t.slice(firstArr, lastArr + 1).trim();

  return t;
}

function toolCatalogLines(tools: any[]): string[] {
  const lines: string[] = [];
  const list = Array.isArray(tools) ? tools : [];
  const funcs = list
    .filter((t) => t && typeof t === "object" && (t as any).type === "function" && (t as any).function)
    .map((t) => (t as any).function)
    .filter((f) => f && typeof f === "object" && typeof f.name === "string");

  if (funcs.length === 0) return lines;

  lines.push("Available tools (OpenAI function schema):");
  for (const f of funcs) {
    const name = String(f.name);
    const desc = typeof f.description === "string" ? f.description.trim() : "";
    const params = f.parameters ?? { type: "object" };
    lines.push(`- ${name}${desc ? `: ${desc}` : ""}`);
    lines.push(`  parameters: ${safeJsonStringify(params)}`);
  }
  return lines;
}

function openAIMessagesToTranscript(messages: any[], tools: any[]): string {
  const lines: string[] = [];

  const catalog = toolCatalogLines(tools);
  let catalogInserted = false;

  for (const m of messages ?? []) {
    const role = typeof m?.role === "string" ? m.role : "";
    const content = normalizeContent(m?.content);
    if (!content) continue;

    if (!catalogInserted && role !== "system" && catalog.length) {
      lines.push(...catalog);
      lines.push("");
      catalogInserted = true;
    }

    if (role === "system") {
      lines.push(`System: ${content}`);
      lines.push("");
      continue;
    }

    if (role === "user") {
      lines.push(`User: ${content}`);
      lines.push("");
      continue;
    }

    if (role === "assistant") {
      lines.push(`Assistant: ${content}`);

      const toolCalls = Array.isArray((m as any)?.tool_calls) ? (m as any).tool_calls : [];
      if (toolCalls.length) {
        lines.push("Assistant requested tool calls:");
        for (const tc of toolCalls) {
          const id = typeof tc?.id === "string" ? tc.id : "";
          const fn = tc?.function;
          const name = typeof fn?.name === "string" ? fn.name : "";
          const args = typeof fn?.arguments === "string" ? fn.arguments : "{}";
          lines.push(`- id=${id} name=${name} arguments=${args}`);
        }
      }
      lines.push("");
      continue;
    }

    if (role === "tool") {
      const callId = typeof (m as any)?.tool_call_id === "string" ? (m as any).tool_call_id : "";
      lines.push(`Tool result${callId ? ` (callId=${callId})` : ""}: ${content}`);
      lines.push("");
      continue;
    }

    // Unknown role: preserve but don't invent structure.
    lines.push(content);
    lines.push("");
  }

  if (!catalogInserted && catalog.length) {
    lines.push(...catalog);
    lines.push("");
    catalogInserted = true;
  }

  // Nudge Codex to answer as the assistant.
  lines.push("Assistant:");

  return lines.join("\n").trim() + "\n";
}

class ToolCallBlockExtractor {
  private readonly openTag = TOOL_CALLS_OPEN_TAG;
  private readonly closeTag = TOOL_CALLS_CLOSE_TAG;

  private readonly keepOpen = Math.max(0, this.openTag.length - 1);
  private readonly keepClose = Math.max(0, this.closeTag.length - 1);

  private pending = "";
  private inBlock = false;
  private sawBlock = false;
  private toolBlock = "";
  private _visibleText = "";

  get visibleText(): string {
    return this._visibleText;
  }
  get toolJsonText(): string {
    return this.toolBlock;
  }
  get hasToolBlock(): boolean {
    return this.sawBlock;
  }

  ingest(chunk: string, emit: (t: string) => void) {
    if (!chunk) return;
    this.pending += chunk;

    // Parse iteratively: there may be multiple blocks or text after a block.
    while (this.pending.length) {
      if (!this.inBlock) {
        const idx = this.pending.indexOf(this.openTag);
        if (idx === -1) {
          // Flush everything except a small tail to avoid leaking the open tag across chunks.
          if (this.keepOpen === 0) {
            this.flushVisible(this.pending, emit);
            this.pending = "";
            return;
          }
          if (this.pending.length <= this.keepOpen) return;
          const flush = this.pending.slice(0, this.pending.length - this.keepOpen);
          this.flushVisible(flush, emit);
          this.pending = this.pending.slice(this.pending.length - this.keepOpen);
          return;
        }

        // Flush text before the open tag.
        const before = this.pending.slice(0, idx);
        if (before) this.flushVisible(before, emit);

        // Consume open tag.
        this.pending = this.pending.slice(idx + this.openTag.length);
        this.inBlock = true;
        this.sawBlock = true;
        continue;
      }

      // inBlock
      const idx = this.pending.indexOf(this.closeTag);
      if (idx === -1) {
        // Keep a small tail to avoid splitting the close tag.
        if (this.keepClose === 0) {
          this.toolBlock += this.pending;
          this.pending = "";
          return;
        }
        if (this.pending.length <= this.keepClose) return;
        this.toolBlock += this.pending.slice(0, this.pending.length - this.keepClose);
        this.pending = this.pending.slice(this.pending.length - this.keepClose);
        return;
      }

      // Close tag found.
      this.toolBlock += this.pending.slice(0, idx);
      this.pending = this.pending.slice(idx + this.closeTag.length);
      this.inBlock = false;
      continue;
    }
  }

  finish(emit: (t: string) => void) {
    if (!this.pending) return;
    if (this.inBlock) {
      // Block opened but not closed: treat the remainder as tool payload.
      this.toolBlock += this.pending;
      this.pending = "";
      return;
    }
    // No open tag pending: safe to flush the tail.
    this.flushVisible(this.pending, emit);
    this.pending = "";
  }

  private flushVisible(t: string, emit: (t: string) => void) {
    if (!t) return;
    this._visibleText += t;
    emit(t);
  }
}

function parseToolCallsFromToolBlock(toolJsonText: string): Map<string, ToolCall> {
  const out = new Map<string, ToolCall>();
  const raw0 = String(toolJsonText ?? "").trim();
  if (!raw0) return out;

  const raw = extractJsonLikeSpan(stripMarkdownCodeFence(raw0));
  if (!raw) return out;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }

  const list: any[] =
    Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.tool_calls)
        ? parsed.tool_calls
        : Array.isArray(parsed?.toolCalls)
          ? parsed.toolCalls
          : parsed && typeof parsed === "object" && (typeof parsed.name === "string" || typeof parsed?.function?.name === "string")
            ? [parsed]
            : [];

  let i = 0;
  for (const tc of list) {
    if (!tc || typeof tc !== "object") continue;
    const fn = (tc as any).function;
    const name =
      (typeof (tc as any).name === "string" && (tc as any).name) ||
      (typeof (tc as any).tool === "string" && (tc as any).tool) ||
      (typeof fn?.name === "string" && fn.name) ||
      "";
    if (!name) continue;

    const callId =
      (typeof (tc as any).id === "string" && (tc as any).id) ||
      (typeof (tc as any).callId === "string" && (tc as any).callId) ||
      crypto.randomUUID();

    const args =
      (tc as any).arguments !== undefined
        ? (tc as any).arguments
        : fn && fn.arguments !== undefined
          ? fn.arguments
          : (tc as any).args;

    const argsRaw = typeof args === "string" ? args : safeJsonStringify(args ?? {});

    const call: ToolCall = { callId, index: i++, name, argsRaw };
    out.set(callId, call);
  }

  return out;
}

async function runCodexAppServerTurn(args: {
  upstreamModel: string;
  prompt: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<{ assistantText: string; toolCalls: Map<string, ToolCall>; finishReason: string | null }> {
  const extractor = new ToolCallBlockExtractor();
  let sawAnyText = false;
  let finishReason: string | null = null;
  let turnCompleted = false;
  let threadId: string | null = null;
  const rpc = spawnCodexAppServerRpc({
    onServerRequest: ({ method, respondResult, respondError }) => {
      // Safety: deny Codex built-in shell/file approvals. ECLIA tool calls are executed via toolhost instead.
      if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
        respondResult({ decision: "decline" });
        return;
      }

      // Unknown request: fail fast so the turn doesn't hang forever.
      respondError(`Unsupported server request: ${method}`);
    },
    onNotification: ({ method, params }) => {
      if (method === "item/agentMessage/delta") {
        const delta =
          (typeof params?.delta === "string" && params.delta) ||
          (typeof params?.textDelta === "string" && params.textDelta) ||
          (typeof params?.text === "string" && params.text) ||
          "";
        if (delta) {
          sawAnyText = true;
          extractor.ingest(delta, args.onDelta);
        }
        return;
      }

      if (method === "item/completed") {
        // Fallback: if we missed deltas, some payloads include the final item text.
        if (!sawAnyText) {
          const item = params?.item;
          const text = typeof item?.text === "string" ? item.text : null;
          if (text) extractor.ingest(text, () => {
            /* no streaming fallback */
          });
        }
        return;
      }

      if (method === "turn/completed") {
        const turn = params?.turn;
        const status = typeof turn?.status === "string" ? turn.status : "completed";
        if (status === "completed") finishReason = "stop";
        else if (status === "interrupted") finishReason = "cancelled";
        else finishReason = status;
        turnCompleted = true;
        return;
      }
    }
  });

  const cleanup = () => {
    rpc.close();
  };

  const onAbort = () => {
    cleanup();
  };

  if (args.signal.aborted) {
    onAbort();
    throw new Error("Aborted");
  }
  args.signal.addEventListener("abort", onAbort, { once: true });

  try {
    // Handshake.
    await rpc.request("initialize", {
      clientInfo: {
        name: "eclia_gateway",
        title: "ECLIA Gateway",
        version: "0.0.0"
      }
    });
    rpc.notify("initialized", {});

    // Ensure we're authenticated. In managed ChatGPT mode, Codex stores tokens on disk
    // and refreshes them automatically, so the app-server should report an account.
    const acct = await rpc.request("account/read", { refreshToken: false });
    const requiresOpenaiAuth = acct?.requiresOpenaiAuth === true;
    const accountType = typeof acct?.account?.type === "string" ? String(acct.account.type) : "";
    if (requiresOpenaiAuth && !accountType) {
      throw new Error(
        'Codex is not authenticated. Open Settings → Inference → Codex OAuth and click "Login with browser".'
      );
    }

    // Start a thread and a turn.
    //
    // Codex has shipped both camelCase ("readOnly") and kebab-case ("read-only") sandbox
    // enum spellings across versions/surfaces. We auto-detect by retrying once when we hit the
    // "unknown variant ... expected one of ..." error.
    let sandboxStyle: CodexSandboxEnumStyle = "kebab";
    const requestWithSandboxRetry = async <T>(run: (style: CodexSandboxEnumStyle) => Promise<T>): Promise<T> => {
      try {
        return await run(sandboxStyle);
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e ?? "");
        const inferred = inferCodexSandboxEnumStyleFromErrorMessage(msg);
        if (inferred && inferred !== sandboxStyle) {
          sandboxStyle = inferred;
          return await run(sandboxStyle);
        }
        throw e;
      }
    };

    const threadRes = await requestWithSandboxRetry((style) =>
      rpc.request("thread/start", {
        model: args.upstreamModel,
        cwd: process.cwd(),
        // Require approvals for Codex built-in tools; the gateway declines these.
        // ECLIA tool calls are executed via the gateway toolhost instead.
        approvalPolicy: "on-request",
        sandbox: codexSandboxValue(style, "readOnly")
      })
    );
    threadId = threadRes?.thread?.id ?? null;
    if (!threadId || typeof threadId !== "string") {
      throw new Error("Codex thread/start returned no thread id");
    }

    await requestWithSandboxRetry((style) =>
      rpc.request("turn/start", {
        threadId,
        input: [{ type: "text", text: args.prompt }],
        // Require approvals for Codex built-in tools; the gateway declines these.
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: codexSandboxValue(style, "readOnly"),
          networkAccess: false
        }
      })
    );

    // Wait for completion, but also let process exit/error short-circuit.
    await Promise.race([
      rpc.waitForNotification("turn/completed", () => true, 5 * 60_000),
      rpc.exitPromise
    ]);

    if (!turnCompleted) {
      // Defensive: in case we returned due to exitPromise or timeout.
      finishReason = finishReason ?? "unknown";
    }

    // Flush any trailing tail now that we know the turn is done.
    extractor.finish(args.onDelta);

    const toolCalls = parseToolCallsFromToolBlock(extractor.toolJsonText);

    // If Codex requested tool calls, surface them to the gateway tool loop.
    if (toolCalls.size > 0) finishReason = "tool_calls";

    let assistantText = extractor.visibleText.trimEnd();

    // Robustness: if Codex attempted a tool-call block but we couldn't parse it,
    // surface a visible error so the UI doesn't show an empty assistant bubble.
    if (toolCalls.size === 0 && extractor.hasToolBlock) {
      const raw = String(extractor.toolJsonText ?? "").trim();
      const snippet = raw.length > 240 ? raw.slice(0, 240).trimEnd() + "…" : raw;
      const errText =
        `\n\n[error] Codex emitted an invalid ${TOOL_CALLS_OPEN_TAG} payload ` +
        `(expected valid JSON with tool_calls).` +
        (snippet ? `\nPayload snippet: ${snippet}` : "");
      assistantText = (assistantText || "") + errText;
      try {
        args.onDelta(errText);
      } catch {
        // ignore streaming errors
      }
    }

    return { assistantText, toolCalls, finishReason };
  } catch (e: any) {
    throw new Error(formatCodexError(e));
  } finally {
    cleanup();
    args.signal.removeEventListener("abort", onAbort);
  }
}

export function createCodexAppServerProvider(args: { upstreamModel: string }): UpstreamProvider {
  const upstreamModel = args.upstreamModel;

  return {
    kind: "codex_oauth",
    upstreamModel,
    origin: {
      adapter: "codex_app_server",
      vendor: "openai",
      model: upstreamModel
    },

    buildContext(history, tokenLimit): BuiltContext {
      return buildTruncatedContext(history, tokenLimit);
    },

    async streamTurn({ headers, messages, tools, signal, onDelta, debug }): Promise<ProviderTurnResult> {
      // messages are OpenAI-ish. Turn into a single prompt for Codex.
      const prompt = openAIMessagesToTranscript(messages, tools);

      if (debug) {
        dumpUpstreamRequestBody({
          rootDir: debug.rootDir,
          sessionId: debug.sessionId,
          seq: debug.seq,
          providerKind: "codex_oauth",
          upstreamModel,
          url: "codex_app_server",
          body: {
            model: upstreamModel,
            prompt
          }
        });
      }

      let assistantText: string;
      let toolCalls: Map<string, ToolCall>;
      let finishReason: string | null;
      try {
        const out = await runCodexAppServerTurn({
          upstreamModel,
          prompt,
          signal,
          onDelta
        });
        assistantText = out.assistantText;
        toolCalls = out.toolCalls;
        finishReason = out.finishReason;
      } catch (e) {
        const code = (e as any)?.code;
        if (code === "ENOENT") {
          throw new Error(
            "Codex app-server executable not found. Install the OpenAI Codex CLI (`codex`) and ensure it is on your PATH."
          );
        }
        throw e;
      }

      return {
        assistantText,
        toolCalls,
        finishReason
      };
    },

    buildAssistantToolCallMessage({ assistantText, toolCalls }) {
      return {
        role: "assistant",
        content: assistantText,
        tool_calls: toolCalls.map((t) => ({
          id: t.callId,
          type: "function",
          function: {
            name: t.name,
            arguments: t.argsRaw
          }
        }))
      };
    },

    buildToolResultMessages({ results }: { results: ToolResult[] }) {
      return results.map((r) => ({ role: "tool", tool_call_id: r.callId, content: r.content }));
    }
  };
}
