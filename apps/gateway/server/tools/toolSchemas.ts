/**
 * Tool names exposed to the model.
 *
 * NOTE: The JSON Schemas for exec are discovered at runtime from the MCP toolhost
 * (tools/list) and adapted to the upstream OpenAI-compatible `tools` format.
 *
 * Some tools (e.g. `send`) are gateway-native and have schemas defined locally.
 */

export const EXEC_TOOL_NAME = "exec";

// Gateway-native tool: deliver messages/artifacts back to the request origin (web/discord/etc.).
export const SEND_TOOL_NAME = "send";

// Gateway-native tool: web search / extract (provider-backed, e.g. Tavily).
export const WEB_TOOL_NAME = "web";

// Gateway-native tool: forward structured memory emission calls to the memory service.
// NOTE: Internal by default; only exposed when explicitly enabled by the caller.
export const MEMORY_TOOL_NAME = "memory";
