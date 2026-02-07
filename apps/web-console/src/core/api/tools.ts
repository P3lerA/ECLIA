export type ToolApprovalDecision = "approve" | "deny";

export type ToolApprovalResponse =
  | { ok: true }
  | { ok: false; error: string; hint?: string };

/**
 * Approve/deny a pending tool request.
 *
 * The gateway keeps approvals in-memory (ephemeral). If the gateway restarts,
 * pending approvals are lost and will need to be re-issued.
 */
export async function apiApproveTool(args: {
  approvalId: string;
  decision: ToolApprovalDecision;
  sessionId?: string;
}): Promise<void> {
  const approvalId = String(args.approvalId ?? "").trim();
  const decision = args.decision;
  const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;

  if (!approvalId) throw new Error("missing approvalId");
  if (decision !== "approve" && decision !== "deny") throw new Error("invalid decision");

  const r = await fetch("/api/tool-approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId, decision, sessionId })
  });

  const j = (await r.json().catch(() => ({ ok: false, error: "bad_json" }))) as ToolApprovalResponse;
  if (!j.ok) throw new Error(j.hint ?? j.error);
}
