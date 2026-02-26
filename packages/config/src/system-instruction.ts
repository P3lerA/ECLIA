import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./root.js";

const SYSTEM_INSTRUCTION_FILE = "_system.md";
const SYSTEM_INSTRUCTION_LOCAL_FILE = "_system.local.md";
const DEFAULT_SYSTEM_INSTRUCTION_FILE_CONTENT = `You are running as a coding agent in the **ECLIA** on user's computer.`;
const SYSTEM_PLACEHOLDER_USER_PREFERRED_NAME = "{{USER_PREFERRED_NAME}}";
const SYSTEM_PLACEHOLDER_ASSISTANT_NAME = "{{ASSISTANT_NAME}}";

function tryReadText(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    if (!st.isFile()) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Ensure root-level system instruction files exist:
 * - _system.md (committed default)
 * - _system.local.md (gitignored local override, initialized from _system.md)
 */
export function ensureSystemInstructionFiles(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  systemPath: string;
  localPath: string;
  createdSystem: boolean;
  createdLocal: boolean;
} {
  const systemPath = path.join(rootDir, SYSTEM_INSTRUCTION_FILE);
  const localPath = path.join(rootDir, SYSTEM_INSTRUCTION_LOCAL_FILE);
  let createdSystem = false;
  let createdLocal = false;

  if (!fs.existsSync(systemPath)) {
    try {
      fs.writeFileSync(systemPath, DEFAULT_SYSTEM_INSTRUCTION_FILE_CONTENT + "\n", {
        encoding: "utf-8",
        flag: "wx"
      });
      createdSystem = true;
    } catch {
      // best-effort
    }
  }

  if (!fs.existsSync(localPath)) {
    try {
      const base = tryReadText(systemPath) ?? "";
      fs.writeFileSync(localPath, base, { encoding: "utf-8", flag: "wx" });
      createdLocal = true;
    } catch {
      // best-effort
    }
  }

  return { rootDir, systemPath, localPath, createdSystem, createdLocal };
}

export function readSystemInstruction(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  systemPath: string;
  localPath: string;
  text: string;
  source: "local" | "base" | "none";
} {
  const systemPath = path.join(rootDir, SYSTEM_INSTRUCTION_FILE);
  const localPath = path.join(rootDir, SYSTEM_INSTRUCTION_LOCAL_FILE);

  const localText = tryReadText(localPath);
  if (localText !== null) return { rootDir, systemPath, localPath, text: localText, source: "local" };

  const baseText = tryReadText(systemPath);
  if (baseText !== null) return { rootDir, systemPath, localPath, text: baseText, source: "base" };

  return { rootDir, systemPath, localPath, text: "", source: "none" };
}

export function writeSystemInstructionLocal(rootDir: string, text: string): void {
  const { localPath } = ensureSystemInstructionFiles(rootDir);
  try {
    fs.writeFileSync(localPath, String(text ?? ""), "utf-8");
  } catch {
    // best-effort
  }
}

export function renderSystemInstructionTemplate(
  template: string,
  vars: { userPreferredName?: string; assistantName?: string }
): string {
  const userPreferredName = String(vars.userPreferredName ?? "").trim() || "User";
  const assistantName = String(vars.assistantName ?? "").trim() || "ALyCE";

  return String(template ?? "")
    .replaceAll(SYSTEM_PLACEHOLDER_USER_PREFERRED_NAME, userPreferredName)
    .replaceAll(SYSTEM_PLACEHOLDER_ASSISTANT_NAME, assistantName);
}
