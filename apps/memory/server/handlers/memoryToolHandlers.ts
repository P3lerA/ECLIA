import http from "node:http";

import { json, now, readJson } from "../httpUtils.js";
import type { ToolSessionLogger } from "../tools/toolSessionLogger.js";
import { MEMORY_TOOL_NAME, validateMemoryEmitArgs } from "../tools/memoryTool.js";

export async function handleMemoryTool(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: {
    toolLogger: ToolSessionLogger;
  }
) {
  const body = await readJson(req);
  const vr = validateMemoryEmitArgs(body);

  const ts = now();

  if (!vr.ok) {
    // Record the malformed attempt so we can audit/iterate on prompting.
    await ctx.toolLogger.append({
      ts,
      kind: "tool_error",
      tool: MEMORY_TOOL_NAME,
      error: vr.error,
      issues: vr.issues
    });

    return json(res, 400, {
      ok: false,
      error: "invalid_tool_args",
      tool: MEMORY_TOOL_NAME,
      issues: vr.issues
    });
  }

  await ctx.toolLogger.append({
    ts,
    kind: "tool_call",
    tool: MEMORY_TOOL_NAME,
    args: vr.value
  });

  // Tool response kept compact: it acknowledges acceptance and returns the
  // normalized payload (helpful for deterministic downstream processing).
  return json(res, 200, {
    ok: true,
    tool: MEMORY_TOOL_NAME,
    accepted: vr.value.memories.length,
    memories: vr.value.memories
  });
}
