import http from "node:http";

import { json, readJson } from "@eclia/gateway-client/utils";
import { now } from "../httpUtils.js";
import type { ToolSessionLogger } from "../tools/toolSessionLogger.js";
import { MEMORY_TOOL_NAME, validateMemoryToolArgs } from "../tools/memoryTool.js";
import type { JsonMemoryStore } from "../store/jsonStore.js";

export async function handleMemoryTool(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: {
    toolLogger: ToolSessionLogger;
    store: JsonMemoryStore;
  }
) {
  const body = await readJson(req);
  const vr = validateMemoryToolArgs(body);

  const ts = now();

  if (!vr.ok) {
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

  const { action } = vr.value;

  if (action === "delete") return handleDelete(res, ctx, vr.value.id);
  return handleMemorize(res, ctx, vr.value.text);
}

async function handleMemorize(
  res: http.ServerResponse,
  ctx: { store: JsonMemoryStore },
  text: string
) {
  if (!text) {
    return json(res, 200, { ok: true, tool: MEMORY_TOOL_NAME, stored: false, reason: "empty_candidate" });
  }

  const created = await ctx.store.createFact(text);

  return json(res, 200, {
    ok: true,
    tool: MEMORY_TOOL_NAME,
    stored: true,
    id: created.id
  });
}

async function handleDelete(
  res: http.ServerResponse,
  ctx: { store: JsonMemoryStore },
  id: number
) {
  const deleted = await ctx.store.deleteFact(String(id));

  return json(res, 200, {
    ok: true,
    tool: MEMORY_TOOL_NAME,
    action: "delete",
    id,
    deleted
  });
}
