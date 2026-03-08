import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type ToolSessionLogger = {
  sessionId: string;
  append: (event: unknown) => Promise<void>;
};

/**
 * Minimal append-only NDJSON logger.
 *
 * We use this as a "no-context" audit trail for memory bootstrapping / write flows.
 */
export function createToolSessionLogger(args: { rootDir: string; sessionId: string }): ToolSessionLogger {
  const dir = path.join(args.rootDir, ".eclia", "memory", "tool-sessions");
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${args.sessionId}.ndjson`);

  return {
    sessionId: args.sessionId,
    append: async (event: unknown) => {
      const line = JSON.stringify(event) + "\n";
      await fsp.appendFile(filePath, line, "utf-8");
    }
  };
}
