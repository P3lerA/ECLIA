import React from "react";
import ReactMarkdown from "react-markdown";
import type { CodeBlock, TextBlock, ToolBlock, ThoughtBlock } from "../types";
import type { BlockRendererRegistry } from "./BlockRendererRegistry";
import { apiApproveTool, type ToolApprovalDecision } from "../api/tools";
import { apiArtifactUrl } from "../api/artifacts";
import { useAppState } from "../../state/AppState";
import { tryFormatToolPayload } from "./toolPayloadFormat";

export function registerDefaultBlockRenderers(registry: BlockRendererRegistry) {
  registry.register("text", (b: TextBlock) => <TextBlockView block={b} />);

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
  registry.register("thought", (b: ThoughtBlock) => <ThoughtBlockView block={b} />);
}

function isSafeHref(href: string): boolean {
  const s = String(href ?? "").trim();
  if (!s) return false;

  // Relative URLs and in-page anchors.
  if (s.startsWith("#") || s.startsWith("/") || s.startsWith("./") || s.startsWith("../")) return true;

  // If there's no explicit scheme, treat it as relative.
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) return true;

  const scheme = m[1].toLowerCase();
  return scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel";
}

function TextBlockView({ block }: { block: TextBlock }) {
  const plainOutput = Boolean(useAppState().settings.displayPlainOutput);

  // Plain output mode: do NOT render markdown.
  if (plainOutput) {
    return <p className="block-text">{block.text}</p>;
  }

  // Default mode: render markdown (CommonMark) safely.
  // Note: we intentionally do NOT enable raw HTML rendering (rehype-raw).
  return (
    <div className="block-markdown">
      <ReactMarkdown
        components={{
          pre({ children, node: _node, ...props }) {
            // For fenced code blocks, the language (if any) is typically encoded as a
            // className on the nested <code> element: "language-xyz".
            // We show a small header with that value; when absent, we show "text".
            let lang: string | null = null;

            const nodes: any[] = Array.isArray(children) ? (children as any[]) : [children];
            for (const ch of nodes) {
              if (!React.isValidElement(ch)) continue;
              const className = (ch.props as any)?.className;
              if (typeof className !== "string") continue;
              const m = className.match(/\blanguage-([^\s]+)/);
              if (m) {
                lang = m[1];
                break;
              }
            }

            return (
              <div className="md-codeblock">
                <div className="block-code-head">{lang ?? "text"}</div>
                <pre {...props}>{children}</pre>
              </div>
            );
          },
          a({ href, children, node: _node, ...props }) {
            const h = typeof href === "string" ? href : "";
            const safe = isSafeHref(h);
            if (!safe) {
              return <span className="md-link-disabled">{children}</span>;
            }
            return (
              <a href={h} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          }
        }}
      >
        {block.text}
      </ReactMarkdown>
    </div>
  );
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
  const plainOutput = Boolean(useAppState().settings.displayPlainOutput);

  const payload: any = block.payload ?? {};
  const approval = payload?.approval ?? null;
  const approvalId = typeof approval?.id === "string" ? approval.id : "";
  const approvalRequired = Boolean(approval?.required && approvalId);
  const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : undefined;

  const parseWarning = typeof (payload as any)?.parseWarning === "string" ? String((payload as any).parseWarning).trim() : "";

  const artifacts = extractArtifacts(payload);
  const isSendTool = block.name === "send";
  const hidePayloadInRichView = isSendTool && block.status === "ok";

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
        <div style={{ marginTop: 8 }}>
          <div className="block-tool-actions" style={{ marginTop: 0 }}>
            <span className="muted">
              approval: {decision ? decision : busy ? "sending…" : "required"}
            </span>
            <div className="block-tool-actionsBtns">
              <button className="btn" disabled={busy || !!decision} onClick={() => void takeDecision("approve")}>Approve</button>
              <button className="btn" disabled={busy || !!decision} onClick={() => void takeDecision("deny")}>Deny</button>
            </div>
          </div>
          {parseWarning ? (
            <div className="muted" style={{ marginTop: 6 }}>[warning] {parseWarning}</div>
          ) : null}
        </div>
      ) : null}

      {err ? <div className="muted" style={{ marginTop: 6 }}>[error] {err}</div> : null}

      {!plainOutput && artifacts.length ? (
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
                  {!isSendTool ? <span className="muted">· {p}</span> : null}
                </div>

                {isImage ? <img className="artifact-img" src={url} alt={label} loading="lazy" /> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {plainOutput ? (
        <pre className="code-lite">{JSON.stringify(payload ?? {}, null, 2)}</pre>
      ) : hidePayloadInRichView ? null : (
        <ToolPayloadRendered block={block} payload={payload} />
      )}
    </div>
  );
}

function ToolPayloadRendered({ block, payload }: { block: ToolBlock; payload: any }) {
  const formatted = tryFormatToolPayload(block, payload);

  if (formatted?.kind === "tool_call_raw") {
    return (
      <div>
        <pre className="code-lite">{formatted.raw}</pre>
        {formatted.parseError ? (
          <div className="muted" style={{ marginTop: 6 }}>[error] {formatted.parseError}</div>
        ) : null}
      </div>
    );
  }

  if (formatted?.kind === "exec_stdout_stderr") {
    const stdout = formatted.stdout ?? "";
    const stderr = formatted.stderr ?? "";

    if (!stdout && !stderr) {
      return <div className="muted" style={{ marginTop: 6 }}>[no output]</div>;
    }

    return (
      <div>
        {stdout ? (
          <div style={{ marginTop: 6 }}>
            <div className="muted">stdout</div>
            <pre className="code-lite">{stdout}</pre>
          </div>
        ) : null}
        {stderr ? (
          <div style={{ marginTop: 6 }}>
            <div className="muted">stderr</div>
            <pre className="code-lite">{stderr}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  if (formatted?.kind === "exec_error_summary") {
    const stdout = formatted.stdout ?? "";
    const stderr = formatted.stderr ?? "";
    const exitCode = formatted.exitCode;

    return (
      <div>
        <div style={{ marginTop: 6 }}>
          <div className="muted">exitCode</div>
          <pre className="code-lite">{exitCode === null ? "null" : String(exitCode)}</pre>
        </div>

        {stdout ? (
          <div style={{ marginTop: 6 }}>
            <div className="muted">stdout</div>
            <pre className="code-lite">{stdout}</pre>
          </div>
        ) : null}
        {stderr ? (
          <div style={{ marginTop: 6 }}>
            <div className="muted">stderr</div>
            <pre className="code-lite">{stderr}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  if (formatted?.kind === "send_error_summary") {
    const stdout = formatted.stdout ?? "";
    const stderr = formatted.stderr ?? "";
    const exitCode = formatted.exitCode;

    return (
      <div>
        <div style={{ marginTop: 6 }}>
          <div className="muted">exitCode</div>
          <pre className="code-lite">{exitCode === null ? "null" : String(exitCode)}</pre>
        </div>

        {stdout ? (
          <div style={{ marginTop: 6 }}>
            <div className="muted">stdout</div>
            <pre className="code-lite">{stdout}</pre>
          </div>
        ) : null}
        {stderr ? (
          <div style={{ marginTop: 6 }}>
            <div className="muted">stderr</div>
            <pre className="code-lite">{stderr}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  // Fallback: keep JSON (compact but complete enough).
  if (block.name === "send" && block.status === "error") {
    // In rich mode, avoid dumping a huge JSON blob for send errors. Users can toggle
    // "display plain text" to see the raw payload.
    const out = (payload && typeof payload === "object" && (payload as any).output) ? (payload as any).output : payload;
    const msg =
      out && typeof out === "object" && (out as any).error && typeof (out as any).error.message === "string"
        ? String((out as any).error.message)
        : "send failed";
    return <div className="muted" style={{ marginTop: 6 }}>[error] {msg}</div>;
  }

  return <pre className="code-lite">{JSON.stringify(payload ?? {}, null, 2)}</pre>;
}

function ThoughtBlockView({ block }: { block: ThoughtBlock }) {
  const plainOutput = Boolean(useAppState().settings.displayPlainOutput);

  if (plainOutput) {
    return (
      <div className="block-thought">
        <div className="muted">thought</div>
        <pre className="code-lite">{`<think>\n${block.text}\n</think>`}</pre>
      </div>
    );
  }

  // Default: hidden/collapsed (dev-friendly).
  return (
    <details className="block-thought">
      <summary className="muted">thought</summary>
      <pre className="code-lite">{block.text}</pre>
    </details>
  );
}
