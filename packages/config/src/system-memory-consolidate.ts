import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./root.js";
import { renderSystemInstructionTemplate } from "./system-instruction.js";

const SYSTEM_MEMORY_CONSOLIDATE_TEMPLATE_FILE = "_system_memory_consolidate.md";
const SYSTEM_MEMORY_CONSOLIDATE_TEMPLATE_LOCAL_FILE = "_system_memory_consolidate.local.md";

const DEFAULT_SYSTEM_MEMORY_CONSOLIDATE_TEMPLATE_FILE_CONTENT = `You are ECLIA's memory consolidator.

You will receive a numbered list of stored memory facts (each with an ID).
Review them and remove duplicates, merge overlapping facts, and delete irrelevant entries.

Available actions (via the \`memory\` tool):
- delete: { "action": "delete", "ids": [3, 7] }
- merge: { "action": "merge", "ids": [1, 5], "content": "merged fact text" }

If no changes are needed, reply with: NONE
`;

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

export function ensureSystemMemoryConsolidateTemplateFiles(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  createdTemplate: boolean;
  createdLocal: boolean;
} {
  const templatePath = path.join(rootDir, SYSTEM_MEMORY_CONSOLIDATE_TEMPLATE_FILE);
  const localPath = path.join(rootDir, SYSTEM_MEMORY_CONSOLIDATE_TEMPLATE_LOCAL_FILE);

  let createdTemplate = false;
  let createdLocal = false;

  if (!fs.existsSync(templatePath)) {
    try {
      fs.writeFileSync(templatePath, DEFAULT_SYSTEM_MEMORY_CONSOLIDATE_TEMPLATE_FILE_CONTENT, { encoding: "utf-8", flag: "wx" });
      createdTemplate = true;
    } catch {
      // best-effort
    }
  }

  if (!fs.existsSync(localPath)) {
    try {
      const base = tryReadText(templatePath) ?? "";
      fs.writeFileSync(localPath, base, { encoding: "utf-8", flag: "wx" });
      createdLocal = true;
    } catch {
      // best-effort
    }
  }

  return { rootDir, templatePath, localPath, createdTemplate, createdLocal };
}

export function readSystemMemoryConsolidateTemplate(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  text: string;
  source: "local" | "base" | "none";
} {
  const templatePath = path.join(rootDir, SYSTEM_MEMORY_CONSOLIDATE_TEMPLATE_FILE);
  const localPath = path.join(rootDir, SYSTEM_MEMORY_CONSOLIDATE_TEMPLATE_LOCAL_FILE);

  const localText = tryReadText(localPath);
  if (localText !== null) return { rootDir, templatePath, localPath, text: localText, source: "local" };

  const baseText = tryReadText(templatePath);
  if (baseText !== null) return { rootDir, templatePath, localPath, text: baseText, source: "base" };

  return { rootDir, templatePath, localPath, text: "", source: "none" };
}

export function renderSystemMemoryConsolidateTemplate(
  template: string,
  vars: {
    userPreferredName?: string;
    assistantName?: string;
  }
): string {
  return renderSystemInstructionTemplate(String(template ?? ""), {
    userPreferredName: vars.userPreferredName,
    assistantName: vars.assistantName
  });
}
