import React from "react";
import type { CodeBlock, TextBlock, ToolBlock } from "../types";
import type { BlockRendererRegistry } from "./BlockRendererRegistry";

export function registerDefaultBlockRenderers(registry: BlockRendererRegistry) {
  registry.register("text", (b: TextBlock) => (
    <p className="block-text">{b.text}</p>
  ));

  registry.register("code", (b: CodeBlock) => (
    <div className="block-code">
      <div className="block-code-head">{b.language ?? "code"}</div>
      <pre className="code">
        <code>{b.code}</code>
      </pre>
    </div>
  ));

  registry.register("tool", (b: ToolBlock) => (
    <div className="block-tool">
      <div className="block-tool-head">
        <strong>Tool</strong> <span className="k">{b.name}</span>{" "}
        <span className="muted">· {b.status}</span>
      </div>
      <pre className="code-lite">{JSON.stringify(b.payload ?? {}, null, 2)}</pre>
    </div>
  ));
}
