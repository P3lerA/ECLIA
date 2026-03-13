import fs from "node:fs";

import { findProjectRoot } from "./root.js";
import { ensureTemplateFiles, readTemplate } from "./template-utils.js";

const SYSTEM_INSTRUCTION_FILE = "_system.md";
const SYSTEM_INSTRUCTION_LOCAL_FILE = "_system.local.md";
const DEFAULT_SYSTEM_INSTRUCTION_FILE_CONTENT = `You are running as a coding agent in the **ECLIA** on user's computer.\n`;
const SYSTEM_PLACEHOLDER_USER_PREFERRED_NAME = "{{USER_PREFERRED_NAME}}";
const SYSTEM_PLACEHOLDER_ASSISTANT_NAME = "{{ASSISTANT_NAME}}";

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
  const { templatePath, localPath, createdTemplate, createdLocal } = ensureTemplateFiles(
    rootDir,
    SYSTEM_INSTRUCTION_FILE,
    SYSTEM_INSTRUCTION_LOCAL_FILE,
    DEFAULT_SYSTEM_INSTRUCTION_FILE_CONTENT
  );
  return { rootDir, systemPath: templatePath, localPath, createdSystem: createdTemplate, createdLocal };
}

export function readSystemInstruction(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  systemPath: string;
  localPath: string;
  text: string;
  source: "local" | "base" | "none";
} {
  const result = readTemplate(rootDir, SYSTEM_INSTRUCTION_FILE, SYSTEM_INSTRUCTION_LOCAL_FILE);
  return { rootDir, systemPath: result.templatePath, localPath: result.localPath, text: result.text, source: result.source };
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
