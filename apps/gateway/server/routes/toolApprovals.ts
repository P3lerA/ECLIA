import http from "node:http";

import { json, readJson } from "../httpUtils.js";
import { ToolApprovalHub, type ToolApprovalDecision } from "../tools/approvalHub.js";

export async function handleToolApprovals(req: http.IncomingMessage, res: http.ServerResponse, approvals: ToolApprovalHub) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });
  const body = (await readJson(req)) as any;

  const approvalId = String(body.approvalId ?? "").trim();
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;
  const decision: ToolApprovalDecision | null = body.decision === "approve" ? "approve" : body.decision === "deny" ? "deny" : null;

  if (!approvalId || !decision) return json(res, 400, { ok: false, error: "bad_request" });

  const r = approvals.decide({ approvalId, sessionId, decision });
  if (r.ok) return json(res, 200, { ok: true });
  if (r.error === "wrong_session") return json(res, 403, { ok: false, error: "wrong_session" });
  return json(res, 404, { ok: false, error: "not_found" });
}
