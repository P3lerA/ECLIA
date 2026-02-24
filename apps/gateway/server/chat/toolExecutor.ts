import { parseExecArgs } from "@eclia/tool-protocol";

import type { SessionStore } from "../sessionStore.js";
import type { SessionMetaV1 } from "../sessionTypes.js";
import type { ToolApprovalHub } from "../tools/approvalHub.js";
import {
  planToolApproval,
  waitForToolApproval,
  approvalOutcomeToError,
  type ToolApprovalWaiter,
  type ToolSafetyCheck
} from "../tools/approvalFlow.js";
import {
  checkExecNeedsApproval,
  type ExecAllowlistRule,
  type ToolAccessMode
} from "../tools/policy.js";
import {
  checkSendNeedsApproval,
  parseSendArgs,
  prepareSendAttachments
} from "../tools/native/sendTool.js";
import {
  checkWebNeedsApproval,
  invokeWebTool,
  parseWebArgs
} from "../tools/native/webTool.js";
import { EXEC_TOOL_NAME, SEND_TOOL_NAME, WEB_TOOL_NAME } from "../tools/toolSchemas.js";
import type { McpStdioClient } from "../mcp/stdioClient.js";
import type { ToolCall, UpstreamProvider } from "../upstream/provider.js";
import { safeJsonStringify } from "../httpUtils.js";
import { sanitizeExecResultForUiAndModel } from "../tools/execResultSanitize.js";

import { guessDiscordAdapterBaseUrl, postDiscordAdapterSend } from "./discordAdapter.js";

function defaultNoop() {
  // intentionally empty
}

type PlannedToolCall = {
  call: ToolCall;
  parsed: any;
  parseError?: string;
  approvalInfo: any | null;
  waiter?: ToolApprovalWaiter;
  safetyCheck?: ToolSafetyCheck;
  execArgs?: ReturnType<typeof parseExecArgs>;
  sendArgs?: ReturnType<typeof parseSendArgs>;
  webArgs?: ReturnType<typeof parseWebArgs>;
};

export async function runToolCalls(args: {
  store: SessionStore;
  approvals: ToolApprovalHub;
  sessionId: string;
  rootDir: string;
  provider: UpstreamProvider;

  mcpExec: McpStdioClient;
  nameToMcpTool: (name: string) => string;

  toolCalls: ToolCall[];
  enabledToolSet: Set<string> | null;
  toolAccessMode: ToolAccessMode;
  execAllowlist: ExecAllowlistRule[];

  requestedOrigin: SessionMetaV1["origin"] | undefined;
  patchedOrigin: SessionMetaV1["origin"] | undefined;
  storedOrigin: SessionMetaV1["origin"] | undefined;

  config: any;
  rawConfig?: any;

  parseWarningByCall?: Map<string, string>;
  emit?: (event: string, data: any) => void;
  isCancelled?: () => boolean;
}): Promise<{ toolMessages: any[] }> {
  const emit = typeof args.emit === "function" ? args.emit : defaultNoop;
  const isCancelled = typeof args.isCancelled === "function" ? args.isCancelled : () => false;
  const parseWarningByCall = args.parseWarningByCall ?? new Map<string, string>();

  // 1) Parse args + plan approvals + emit tool_call blocks (now we have complete args).
  const plannedCalls: PlannedToolCall[] = [];

  for (const call of args.toolCalls) {
    let parsed: any = null;
    let parseError: string | undefined;
    try {
      parsed = call.argsRaw ? JSON.parse(call.argsRaw) : {};
    } catch (e: any) {
      parsed = {};
      parseError = String(e?.message ?? e);
    }

    let approvalInfo: any | null = null;
    let waiter: ToolApprovalWaiter | undefined;
    let safetyCheck: ToolSafetyCheck | undefined;
    let execArgs: ReturnType<typeof parseExecArgs> | undefined;
    let sendArgs: ReturnType<typeof parseSendArgs> | undefined;
    let webArgs: ReturnType<typeof parseWebArgs> | undefined;

    const toolEnabled = !args.enabledToolSet || args.enabledToolSet.has(call.name);

    if (toolEnabled && call.name === EXEC_TOOL_NAME) {
      execArgs = parseExecArgs(parsed);
      safetyCheck = checkExecNeedsApproval(execArgs, args.toolAccessMode, args.execAllowlist);

      const plan = planToolApproval({ approvals: args.approvals, sessionId: args.sessionId, check: safetyCheck, timeoutMs: 5 * 60_000 });
      approvalInfo = plan.approval;
      waiter = plan.waiter;
    } else if (toolEnabled && call.name === SEND_TOOL_NAME) {
      sendArgs = parseSendArgs(parsed);
      safetyCheck = checkSendNeedsApproval(sendArgs, args.toolAccessMode);

      const plan = planToolApproval({ approvals: args.approvals, sessionId: args.sessionId, check: safetyCheck, timeoutMs: 5 * 60_000 });
      approvalInfo = plan.approval;
      waiter = plan.waiter;
    } else if (toolEnabled && call.name === WEB_TOOL_NAME) {
      webArgs = parseWebArgs(parsed);
      safetyCheck = checkWebNeedsApproval(webArgs, args.toolAccessMode);

      const plan = planToolApproval({ approvals: args.approvals, sessionId: args.sessionId, check: safetyCheck, timeoutMs: 5 * 60_000 });
      approvalInfo = plan.approval;
      waiter = plan.waiter;
    }

    plannedCalls.push({
      call,
      parsed,
      parseError,
      approvalInfo,
      waiter,
      safetyCheck,
      execArgs,
      sendArgs,
      webArgs
    });

    emit("tool_call", {
      callId: call.callId,
      name: call.name,
      args: {
        sessionId: args.sessionId,
        raw: call.argsRaw,
        parsed,
        parseError,
        approval: approvalInfo,
        parseWarning: parseWarningByCall.get(call.callId)
      }
    });
  }

  // 2) Execute tools sequentially and feed results back into the upstream transcript.
  const toolMessages: any[] = [];

  for (const p of plannedCalls) {
    if (isCancelled()) break;

    const call = p.call;
    const name = call.name;

    let ok = false;
    let output: any = null;

    if (args.enabledToolSet && !args.enabledToolSet.has(name)) {
      ok = false;
      output = {
        ok: false,
        error: { code: "tool_disabled", message: `Tool is disabled by client settings: ${name}` }
      };
    } else if (name === EXEC_TOOL_NAME) {
      if (p.parseError) {
        ok = false;
        output = {
          type: "exec_result",
          ok: false,
          error: { code: "bad_arguments_json", message: `Invalid JSON arguments: ${p.parseError}` },
          argsRaw: call.argsRaw
        };
      } else {
        const execArgs = p.execArgs ?? parseExecArgs(p.parsed);
        const check = p.safetyCheck ?? checkExecNeedsApproval(execArgs ?? {}, args.toolAccessMode, args.execAllowlist);
        const waiter = p.waiter;

        const invokeExec = async (): Promise<{ ok: boolean; result: any }> => {
          const mcpToolName = args.nameToMcpTool(name);
          const callTimeoutMs = Math.max(5_000, Math.min(60 * 60_000, (execArgs?.timeoutMs ?? 60_000) + 15_000));

          let mcpOut: any;
          try {
            const mcpArgs =
              p.parsed && typeof p.parsed === "object" && !Array.isArray(p.parsed)
                ? { ...(p.parsed as any), __eclia: { sessionId: args.sessionId, callId: call.callId } }
                : { __eclia: { sessionId: args.sessionId, callId: call.callId } };

            mcpOut = await args.mcpExec.callTool(mcpToolName, mcpArgs, { timeoutMs: callTimeoutMs });
          } catch (e: any) {
            const msg = String(e?.message ?? e);
            return {
              ok: false,
              result: {
                type: "exec_result",
                ok: false,
                error: { code: "toolhost_error", message: msg },
                args: execArgs ?? p.parsed
              }
            };
          }

          const firstText = Array.isArray(mcpOut?.content)
            ? (mcpOut.content.find((c: any) => c && c.type === "text" && typeof c.text === "string") as any)?.text
            : "";

          // Prefer MCP structuredContent when available (canonical machine-readable payload).
          // Fall back to parsing the first text block for backward compatibility.
          let execOut: any = null;
          if (
            mcpOut &&
            typeof mcpOut === "object" &&
            (mcpOut as any).structuredContent &&
            typeof (mcpOut as any).structuredContent === "object"
          ) {
            execOut = (mcpOut as any).structuredContent;
          } else {
            try {
              execOut = firstText ? JSON.parse(firstText) : null;
            } catch {
              execOut = null;
            }
          }

          if (!execOut || typeof execOut !== "object") {
            return {
              ok: false,
              result: {
                type: "exec_result",
                ok: false,
                error: { code: "toolhost_bad_result", message: "Toolhost returned an invalid result" },
                raw: firstText || safeJsonStringify(mcpOut)
              }
            };
          }

          const nextOk = Boolean(execOut.ok) && !mcpOut?.isError;
          return { ok: nextOk, result: { ...execOut, ok: nextOk } };
        };

        if (check.requireApproval) {
          const decision = await waitForToolApproval(waiter);
          if (decision.decision !== "approve") {
            ok = false;
            output = {
              type: "exec_result",
              ok: false,
              error: approvalOutcomeToError(decision, { actionLabel: "exec" }),
              policy: { mode: args.toolAccessMode, ...check, approvalId: waiter?.approvalId },
              args: execArgs ?? p.parsed
            };
          } else {
            const r = await invokeExec();
            ok = r.ok;
            output = {
              type: "exec_result",
              ...r.result,
              ok,
              policy: { mode: args.toolAccessMode, ...check, approvalId: waiter?.approvalId, decision: "approve" }
            };
          }
        } else {
          const r = await invokeExec();
          ok = r.ok;
          output = {
            type: "exec_result",
            ...r.result,
            ok,
            policy: { mode: args.toolAccessMode, ...check }
          };
        }
      }
    } else if (name === SEND_TOOL_NAME) {
      if (p.parseError) {
        ok = false;
        output = {
          type: "send_result",
          ok: false,
          error: { code: "bad_arguments_json", message: `Invalid JSON arguments: ${p.parseError}` },
          argsRaw: call.argsRaw
        };
      } else {
        const sendArgs = p.sendArgs ?? parseSendArgs(p.parsed);
        const check = p.safetyCheck ?? checkSendNeedsApproval(sendArgs, args.toolAccessMode);
        const waiter = p.waiter;

        const invokeSend = async (): Promise<{ ok: boolean; result: any }> => {
          // Destination resolution:
          // - Default is "origin" (request source).
          // - Fallback to persisted session origin.
          const effectiveOrigin = (args.requestedOrigin ?? args.patchedOrigin ?? args.storedOrigin ?? { kind: "web" }) as any;

          let destination: any = sendArgs.destination;
          if (!destination || destination.kind === "origin") destination = effectiveOrigin;

          // If the model specified {kind:"discord"} without ids, inherit from origin when possible.
          if (destination && destination.kind === "discord") {
            if (!destination.channelId && effectiveOrigin?.kind === "discord") {
              destination = { ...effectiveOrigin, ...destination };
              if (!destination.channelId) destination.channelId = effectiveOrigin.channelId;
              if (!destination.threadId && effectiveOrigin.threadId) destination.threadId = effectiveOrigin.threadId;
            }
          }

          if (!destination || typeof destination !== "object") {
            return {
              ok: false,
              result: {
                type: "send_result",
                ok: false,
                error: { code: "invalid_destination", message: "Destination is missing or invalid" },
                args: sendArgs
              }
            };
          }

          const destKind = typeof destination.kind === "string" ? destination.kind : "";
          if (destKind !== "web" && destKind !== "discord") {
            return {
              ok: false,
              result: {
                type: "send_result",
                ok: false,
                error: { code: "invalid_destination", message: `Unsupported destination kind: ${String(destKind)}` },
                args: sendArgs
              }
            };
          }

          const prep = await prepareSendAttachments({
            rootDir: args.rootDir,
            sessionId: args.sessionId,
            callId: call.callId,
            refs: sendArgs.refs,
            paths: sendArgs.paths
          });

          if (!prep.ok) {
            return { ok: false, result: { type: "send_result", ok: false, error: prep.error, args: sendArgs } };
          }

          // Deliver
          if (destKind === "discord") {
            if (!args.config.adapters.discord.enabled) {
              return {
                ok: false,
                result: {
                  type: "send_result",
                  ok: false,
                  error: { code: "adapter_disabled", message: "Discord adapter is disabled" },
                  destination,
                  args: sendArgs,
                  artifacts: prep.value.artifacts,
                  refs: prep.value.refs
                }
              };
            }

            const channelId = typeof destination.channelId === "string" ? destination.channelId.trim() : "";
            if (!channelId) {
              return {
                ok: false,
                result: {
                  type: "send_result",
                  ok: false,
                  error: { code: "invalid_destination", message: "discord destination requires channelId" },
                  destination,
                  args: sendArgs
                }
              };
            }

            const r = await postDiscordAdapterSend({
              adapterBaseUrl: guessDiscordAdapterBaseUrl(),
              adapterKey: process.env.ECLIA_ADAPTER_KEY,
              origin: { ...destination, kind: "discord", channelId },
              content: typeof sendArgs.content === "string" ? sendArgs.content : "",
              refs: prep.value.refs
            });

            if (!r.ok) {
              return {
                ok: false,
                result: {
                  type: "send_result",
                  ok: false,
                  error: r.error,
                  destination,
                  args: sendArgs,
                  artifacts: prep.value.artifacts,
                  refs: prep.value.refs
                }
              };
            }
          }

          return {
            ok: true,
            result: {
              type: "send_result",
              ok: true,
              destination,
              content: typeof sendArgs.content === "string" ? sendArgs.content : "",
              refs: prep.value.refs,
              artifacts: prep.value.artifacts,
              copiedFromPaths: prep.value.copiedFromPaths
            }
          };
        };

        if (check.requireApproval) {
          const decision = await waitForToolApproval(waiter);
          if (decision.decision !== "approve") {
            ok = false;
            output = {
              type: "send_result",
              ok: false,
              error: approvalOutcomeToError(decision, { actionLabel: "send" }),
              policy: { mode: args.toolAccessMode, ...check, approvalId: waiter?.approvalId },
              args: sendArgs
            };
          } else {
            const r = await invokeSend();
            ok = r.ok;
            output = {
              type: "send_result",
              ...r.result,
              ok,
              policy: { mode: args.toolAccessMode, ...check, approvalId: waiter?.approvalId, decision: "approve" }
            };
          }
        } else {
          const r = await invokeSend();
          ok = r.ok;
          output = {
            type: "send_result",
            ...r.result,
            ok,
            policy: { mode: args.toolAccessMode, ...check }
          };
        }
      }
    } else if (name === WEB_TOOL_NAME) {
      if (p.parseError) {
        ok = false;
        output = {
          type: "web_result",
          ok: false,
          error: { code: "bad_arguments_json", message: `Invalid JSON arguments: ${p.parseError}` },
          argsRaw: call.argsRaw
        };
      } else {
        const webArgs = p.webArgs ?? parseWebArgs(p.parsed);
        const check = p.safetyCheck ?? checkWebNeedsApproval(webArgs, args.toolAccessMode);
        const waiter = p.waiter;

        const invokeWeb = async (): Promise<{ ok: boolean; result: any }> => {
          return await invokeWebTool({ parsed: webArgs, rawConfig: args.rawConfig });
        };

        const actionLabel = `web:${webArgs.mode}`;

        if (check.requireApproval) {
          const decision = await waitForToolApproval(waiter);
          if (decision.decision !== "approve") {
            ok = false;
            output = {
              type: "web_result",
              ok: false,
              error: approvalOutcomeToError(decision, { actionLabel }),
              policy: { mode: args.toolAccessMode, ...check, approvalId: waiter?.approvalId },
              args: webArgs
            };
          } else {
            const r = await invokeWeb();
            ok = r.ok;
            output = {
              type: "web_result",
              ...r.result,
              ok,
              policy: { mode: args.toolAccessMode, ...check, approvalId: waiter?.approvalId, decision: "approve" }
            };
          }
        } else {
          const r = await invokeWeb();
          ok = r.ok;
          output = {
            type: "web_result",
            ...r.result,
            ok,
            policy: { mode: args.toolAccessMode, ...check }
          };
        }
      }
    } else {
      ok = false;
      output = { ok: false, error: { code: "unknown_tool", message: `Unknown tool: ${name}` } };
    }

    if (output && typeof output === "object" && (output as any).type === "exec_result") {
      output = await sanitizeExecResultForUiAndModel({
        rootDir: args.rootDir,
        sessionId: args.sessionId,
        callId: call.callId,
        output
      });
    }

    // Stream to UI
    emit("tool_result", { callId: call.callId, name, ok, result: output });

    // Persist
    const toolTs = Date.now();
    const toolContent = safeJsonStringify(output);

    await args.store.appendTranscript(
      args.sessionId,
      {
        role: "tool",
        tool_call_id: call.callId,
        content: toolContent
      } as any,
      toolTs
    );

    // Feed back to model
    toolMessages.push(args.provider.buildToolResultMessage({ callId: call.callId, content: toolContent }));
  }

  return { toolMessages };
}
