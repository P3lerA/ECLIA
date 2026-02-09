import React from "react";
import type { CodeBlock, TextBlock, ToolBlock, ThoughtBlock } from "../types";
import type { BlockRendererRegistry } from "./BlockRendererRegistry";
import { apiApproveTool, type ToolApprovalDecision } from "../api/tools";
import { apiArtifactUrl } from "../api/artifacts";

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

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function extractArtifacts(payload: any): any[] {
  if (!payload || typeof payload !== "object") return [];

  // Live tool_result blocks store the raw output as payload.
  if (Array.isArray((payload as any).artifacts)) return (payload as any).artifacts;

  // Persisted tool blocks store { callId, ok, output }.
  const out = (payload as any).output;
  if (out && typeof out === "object" && Array.isArray(out.artifacts)) return out.artifacts;

  return [];
}

function ToolBlockView({ block }: { block: ToolBlock }) {
  const payload: any = block.payload ?? {};
  const approval = payload?.approval ?? null;
  const approvalId = typeof approval?.id === "string" ? approval.id : "";
  const approvalRequired = Boolean(approval?.required && approvalId);
  const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : undefined;

  const artifacts = extractArtifacts(payload);

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

      {artifacts.length ? (
        <div className="block-tool-artifacts">
          {artifacts.map((a: any, i: number) => {
            const p = typeof a?.path === "string" ? a.path : "";
            if (!p) return null;

            const url = apiArtifactUrl(p);
            const kind = typeof a?.kind === "string" ? a.kind : "file";
            const mime = typeof a?.mime === "string" ? a.mime : "";
            const label = p.split("/").pop() || p;
            const bytes = typeof a?.bytes === "number" ? a.bytes : undefined;
            const isImage = kind === "image" || mime.startsWith("image/");

            return (
              <div key={i} className="artifact-item">
                <div className="artifact-meta">
                  <span className="artifact-kind">{kind}</span>
                  <a href={url} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                  {typeof bytes === "number" ? <span className="muted">· {formatBytes(bytes)}</span> : null}
                  <span className="muted">· {p}</span>
                </div>

                {isImage ? <img className="artifact-img" src={url} alt={label} loading="lazy" /> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <pre className="code-lite">{JSON.stringify(payload ?? {}, null, 2)}</pre>
    </div>
  );
}
