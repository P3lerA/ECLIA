import { ToolApprovalHub, type ToolApprovalOutcome } from "./approvalHub.js";

/**
 * Generic "safe mode" approval helpers.
 *
 * The gateway currently supports interactive tool approvals for exec, and future tools (e.g. send)
 * should reuse these helpers so that safe/full access behavior stays consistent.
 */

export type ToolSafetyCheck = {
  requireApproval: boolean;
  reason: string;
  matchedAllowlist?: string;
};

export type ToolApprovalInfo =
  | { required: true; id: string; reason: string }
  | { required: false; reason: string; matchedAllowlist?: string };

export type ToolApprovalWaiter = {
  approvalId: string;
  wait: Promise<ToolApprovalOutcome>;
};

export function planToolApproval(args: {
  approvals: ToolApprovalHub;
  sessionId: string;
  check: ToolSafetyCheck;
  timeoutMs?: number;
}): { approval: ToolApprovalInfo; waiter?: ToolApprovalWaiter } {
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 5 * 60_000;

  if (args.check.requireApproval) {
    const { approvalId, wait } = args.approvals.create({ sessionId: args.sessionId, timeoutMs });
    return {
      approval: { required: true, id: approvalId, reason: args.check.reason },
      waiter: { approvalId, wait }
    };
  }

  return {
    approval: {
      required: false,
      reason: args.check.reason,
      matchedAllowlist: args.check.matchedAllowlist
    }
  };
}

/**
 * Wait for user approval.
 *
 * If no waiter is present (should be rare), we default to a denied decision so tools don't run
 * unexpectedly in safe mode.
 */
export async function waitForToolApproval(waiter?: ToolApprovalWaiter): Promise<ToolApprovalOutcome> {
  if (!waiter) return { decision: "deny", timedOut: false };
  try {
    return await waiter.wait;
  } catch {
    return { decision: "deny", timedOut: false };
  }
}

export function approvalOutcomeToError(
  outcome: ToolApprovalOutcome,
  opts?: { actionLabel?: string }
): { code: "approval_timeout" | "denied_by_user"; message: string } {
  if (outcome.timedOut) {
    return { code: "approval_timeout", message: "Approval timed out" };
  }

  const label = typeof opts?.actionLabel === "string" && opts.actionLabel.trim() ? opts.actionLabel.trim() : "action";
  return { code: "denied_by_user", message: `User denied ${label}` };
}
