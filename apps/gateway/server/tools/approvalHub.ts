import crypto from "node:crypto";

export type ToolApprovalDecision = "approve" | "deny";

export type ToolApprovalOutcome = {
  decision: ToolApprovalDecision;
  timedOut: boolean;
  /**
   * Session/request was cancelled (e.g. client disconnected).
   * Timed out is still false in this case.
   */
  canceled?: boolean;
};

type PendingApproval = {
  approvalId: string;
  sessionId: string;
  createdAt: number;
  timer: NodeJS.Timeout | null;
  resolve: (r: ToolApprovalOutcome) => void;
  settled: boolean;
};

/**
 * In-memory approval hub.
 *
 * Notes:
 * - approvals are ephemeral (not persisted). If the gateway restarts, pending approvals are lost.
 * - one approval id maps to exactly one decision.
 */
export class ToolApprovalHub {
  private approvals = new Map<string, PendingApproval>();

  create(args: { sessionId: string; timeoutMs: number }): {
    approvalId: string;
    wait: Promise<ToolApprovalOutcome>;
  } {
    const approvalId = crypto.randomUUID();
    const createdAt = Date.now();

    let resolve!: (r: ToolApprovalOutcome) => void;
    const wait = new Promise<ToolApprovalOutcome>((r) => {
      resolve = r;
    });

    const rec: PendingApproval = {
      approvalId,
      sessionId: args.sessionId,
      createdAt,
      timer: null,
      resolve,
      settled: false
    };

    const timeoutMs = Math.max(1_000, Math.min(60 * 60_000, Math.trunc(args.timeoutMs || 0)));
    rec.timer = setTimeout(() => {
      this.settle(rec, { decision: "deny", timedOut: true });
    }, timeoutMs);

    this.approvals.set(approvalId, rec);
    return { approvalId, wait };
  }

  decide(args: {
    approvalId: string;
    decision: ToolApprovalDecision;
    sessionId?: string;
  }): { ok: true } | { ok: false; error: "not_found" | "wrong_session" } {
    const approvalId = String(args.approvalId ?? "").trim();
    if (!approvalId) return { ok: false, error: "not_found" };

    const rec = this.approvals.get(approvalId);
    if (!rec) return { ok: false, error: "not_found" };

    if (args.sessionId && args.sessionId !== rec.sessionId) {
      return { ok: false, error: "wrong_session" };
    }

    const decision = args.decision === "approve" ? "approve" : "deny";
    this.settle(rec, { decision, timedOut: false });
    return { ok: true };
  }

  cancelSession(sessionId: string): void {
    const sid = String(sessionId ?? "").trim();
    if (!sid) return;

    for (const rec of this.approvals.values()) {
      if (rec.sessionId !== sid) continue;
      this.settle(rec, { decision: "deny", timedOut: false, canceled: true });
    }
  }

  private settle(rec: PendingApproval, outcome: ToolApprovalOutcome): void {
    if (rec.settled) return;
    rec.settled = true;

    if (rec.timer) {
      clearTimeout(rec.timer);
      rec.timer = null;
    }

    this.approvals.delete(rec.approvalId);
    try {
      rec.resolve(outcome);
    } catch {
      // ignore
    }
  }
}
