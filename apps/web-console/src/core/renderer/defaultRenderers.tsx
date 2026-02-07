import React from "react";
import type { CodeBlock, TextBlock, ToolBlock, ThoughtBlock } from "../types";
import type { BlockRendererRegistry } from "./BlockRendererRegistry";
import { apiApproveTool, type ToolApprovalDecision } from "../api/tools";

export function registerDefaultBlockRenderers(registry: BlockRendererRegistry) {
  registry.register("text", (b: TextBlock) => <p className="block-text">{b.text}</p>);

  registry.register("code", (b: CodeBlock) => (
    <div className="block-code">
      <div className="block-code-head">{b.language ?? "code"}</div>
      <pre className="code">
        <code>{b.code}</code>
      </pre>
    </div>
  ));

  registry.register("tool", (b: ToolBlock) => <ToolBlockView block={b} />);

  // Thought blocks are hidden/collapsed by default (dev-friendly).
  registry.register("thought", (b: ThoughtBlock) => (
    <details className="block-thought">
      <summary className="muted">thought</summary>
      <pre className="code-lite">{b.text}</pre>
    </details>
  ));
}

function ToolBlockView({ block }: { block: ToolBlock }) {
  const payload: any = block.payload ?? {};
  const approval = payload?.approval ?? null;
  const approvalId = typeof approval?.id === "string" ? approval.id : "";
  const approvalRequired = Boolean(approval?.required && approvalId);
  const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : undefined;

  const [busy, setBusy] = React.useState(false);
  const [decision, setDecision] = React.useState<ToolApprovalDecision | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const takeDecision = async (d: ToolApprovalDecision) => {
    if (!approvalRequired) return;
    if (busy) return;

    setBusy(true);
    setErr(null);

    try {
      await apiApproveTool({ approvalId, decision: d, sessionId });
      setDecision(d);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="block-tool">
      <div className="block-tool-head">
        <strong>Tool</strong> <span className="k">{block.name}</span> <span className="muted">· {block.status}</span>
      </div>

      {approvalRequired ? (
        <div className="block-tool-actions">
          <span className="muted">
            approval: {decision ? decision : busy ? "sending…" : "required"}
          </span>
          <div className="block-tool-actionsBtns">
            <button className="btn" disabled={busy || !!decision} onClick={() => void takeDecision("approve")}>Approve</button>
            <button className="btn" disabled={busy || !!decision} onClick={() => void takeDecision("deny")}>Deny</button>
          </div>
        </div>
      ) : null}

      {err ? <div className="muted" style={{ marginTop: 6 }}>[error] {err}</div> : null}

      <pre className="code-lite">{JSON.stringify(payload ?? {}, null, 2)}</pre>
    </div>
  );
}
