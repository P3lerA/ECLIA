import { buildTruncatedContext } from "../context.js";

import { spawnCodexAppServerRpc } from "./codexAppServerRpc.js";

import type { BuiltContext, ProviderTurnResult, ToolCall, UpstreamProvider } from "./provider.js";

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

function openAIMessagesToTranscript(messages: any[]): string {
  const lines: string[] = [];

  // We deliberately add a safety instruction since, for now, we do not
  // integrate Codex's tool ecosystem with ECLIA's toolhost.
  lines.push(
    "IMPORTANT: You are running inside ECLIA. You cannot execute commands, modify files, or use external tools. Reply with text only."
  );
  lines.push("");

  for (const m of messages ?? []) {
    const role = typeof m?.role === "string" ? m.role : "";
    const content = normalizeContent(m?.content);
    if (!content) continue;

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
      lines.push("");
      continue;
    }

    if (role === "tool") {
      lines.push(`Tool: ${content}`);
      lines.push("");
      continue;
    }

    // Unknown role: preserve but don't invent structure.
    lines.push(content);
    lines.push("");
  }

  // Nudge Codex to answer as the assistant.
  lines.push("Assistant:");

  return lines.join("\n").trim() + "\n";
}

async function runCodexAppServerTurn(args: {
  upstreamModel: string;
  prompt: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<{ assistantText: string; finishReason: string | null }> {
  let assistantText = "";
  let finishReason: string | null = null;
  let turnCompleted = false;
  let threadId: string | null = null;
  const rpc = spawnCodexAppServerRpc({
    onServerRequest: ({ method, respondResult, respondError }) => {
      // Safety: deny all approvals. (We are not integrating Codex's tool loop yet.)
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
          assistantText += delta;
          args.onDelta(delta);
        }
        return;
      }

      if (method === "item/completed") {
        // Fallback: if we missed deltas, some payloads include the final item.
        const item = params?.item;
        const text = typeof item?.text === "string" ? item.text : null;
        if (text && !assistantText) {
          assistantText = text;
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
        'Codex is not authenticated. Open Settings → Inference → Codex OAuth profiles and click "Login with browser".'
      );
    }

    // Start a thread and a turn.
    const threadRes = await rpc.request("thread/start", {
      model: args.upstreamModel,
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "readOnly"
    });
    threadId = threadRes?.thread?.id ?? null;
    if (!threadId || typeof threadId !== "string") {
      throw new Error("Codex thread/start returned no thread id");
    }

    await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: args.prompt }],
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "readOnly",
        networkAccess: false
      }
    });

    // Wait for completion, but also let process exit/error short-circuit.
    await Promise.race([
      rpc.waitForNotification("turn/completed", () => true, 5 * 60_000),
      rpc.exitPromise
    ]);

    if (!turnCompleted) {
      // Defensive: in case we returned due to exitPromise or timeout.
      finishReason = finishReason ?? "unknown";
    }

    if (!assistantText.trim()) {
      // Codex can occasionally stream a completed turn with no agent message.
      assistantText = "";
    }

    return { assistantText, finishReason };
  } catch (e: any) {
    const err = e instanceof Error ? e : new Error(String(e ?? "Unknown error"));
    throw err;
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

    async streamTurn({ headers, messages, tools: _tools, signal, onDelta }): Promise<ProviderTurnResult> {
      // messages are OpenAI-ish. Turn into a single prompt for Codex.
      const prompt = openAIMessagesToTranscript(messages);

      let assistantText: string;
      let finishReason: string | null;
      try {
        const out = await runCodexAppServerTurn({
          upstreamModel,
          prompt,
          signal,
          onDelta
        });
        assistantText = out.assistantText;
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
        toolCalls: new Map(),
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

    buildToolResultMessage({ callId, content }) {
      return { role: "tool", tool_call_id: callId, content };
    }
  };
}
