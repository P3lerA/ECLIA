import http from "node:http";

import { loadEcliaConfig } from "@eclia/config";
import { json } from "@eclia/gateway-client/utils";
import { BASH_TOOL_NAME, SEND_TOOL_NAME, WEB_TOOL_NAME, MEMORY_TOOL_NAME } from "../tools/toolSchemas.js";

/**
 * All tool definitions known to the gateway.
 * label + description are UI-facing metadata.
 */
const ALL_TOOLS = [
  {
    name: BASH_TOOL_NAME,
    label: "bash",
    description: "Run a shell command on the local machine via the gateway toolhost."
  },
  {
    name: SEND_TOOL_NAME,
    label: "send",
    description: "Send text and/or artifacts to the request origin (web/discord) or an explicit destination."
  },
  {
    name: WEB_TOOL_NAME,
    label: "web",
    description: "Web search / extract (provider-backed, e.g. Tavily)."
  },
  {
    name: MEMORY_TOOL_NAME,
    label: "memory",
    description: "Long-term memory. Store and delete facts about the user."
  }
] as const;

export type ToolInfo = {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
};

/**
 * GET /api/tools — returns all known tools with their enabled state from config.
 */
export function handleTools(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "GET") {
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const { config } = loadEcliaConfig(process.cwd());
  const enabledSet = new Set(config.tools.enabled);

  const tools: ToolInfo[] = ALL_TOOLS.map((t) => ({
    name: t.name,
    label: t.label,
    description: t.description,
    enabled: enabledSet.has(t.name)
  }));

  return json(res, 200, { ok: true, tools });
}
