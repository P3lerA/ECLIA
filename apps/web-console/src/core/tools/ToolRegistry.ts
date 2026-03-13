export const TOOL_DEFS = [
  {
    name: "bash",
    label: "bash",
    description: "Run a shell command on the local machine via the gateway toolhost.",
    defaultEnabled: true
  },
  {
    name: "send",
    label: "send",
    description: "Send text and/or artifacts to the request origin (web/discord) or an explicit destination.",
    defaultEnabled: true
  },
  {
    name: "web",
    label: "web",
    description: "Web search / extract (provider-backed, e.g. Tavily).",
    defaultEnabled: true
  },
  {
    name: "memory",
    label: "memory",
    description: "Long-term memory. Store and delete facts about the user.",
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
