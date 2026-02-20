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
