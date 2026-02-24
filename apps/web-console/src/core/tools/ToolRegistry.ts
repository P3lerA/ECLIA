export const TOOL_DEFS = [
  {
    name: "exec",
    label: "exec",
    description: "Execute a shell command on the local machine via the gateway toolhost.",
    defaultEnabled: true
  },
  {
    name: "send",
    label: "send",
    description: "Send text and/or artifacts to the request origin (web/discord) or an explicit destination.",
    defaultEnabled: true
  }
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]["name"];

export type ToolDef = {
  name: ToolName;
  label: string;
  description: string;
  defaultEnabled: boolean;
};

export function listKnownToolNames(): ToolName[] {
  return TOOL_DEFS.map((t) => t.name);
}

export function defaultEnabledToolNames(): ToolName[] {
  return TOOL_DEFS.filter((t) => t.defaultEnabled).map((t) => t.name);
}

/**
 * Normalizes a user-supplied tool list to:
 * - known tool names only
 * - de-duped
 * - stable order (registry order)
 */
export function normalizeEnabledToolNames(input: unknown): ToolName[] {
  const set = new Set<string>();
  if (Array.isArray(input)) {
    for (const v of input) {
      const s = typeof v === "string" ? v.trim() : "";
      if (!s) continue;
      set.add(s);
    }
  }

  const order = listKnownToolNames();
  return order.filter((n) => set.has(n));
}

export class ToolRegistry {
  private map = new Map<ToolName, ToolDef>();

  register(def: ToolDef) {
    this.map.set(def.name, def);
  }

  get(name: ToolName): ToolDef {
    const d = this.map.get(name);
    if (!d) throw new Error(`Unknown tool: ${name}`);
    return d;
  }

  list(): ToolDef[] {
    return [...this.map.values()];
  }
}

export function registerDefaultTools(registry: ToolRegistry) {
  for (const d of TOOL_DEFS) {
    registry.register({ ...d });
  }
}
