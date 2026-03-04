import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./root.js";
import { renderSystemInstructionTemplate } from "./system-instruction.js";

const SYSTEM_MEMORY_EXTRACT_TEMPLATE_FILE = "_system_memory_extract.md";
const SYSTEM_MEMORY_EXTRACT_TEMPLATE_LOCAL_FILE = "_system_memory_extract.local.md";

// Fallback only when the committed template file is missing.
const DEFAULT_SYSTEM_MEMORY_EXTRACT_TEMPLATE_FILE_CONTENT = `You are a memory extractor. Given a truncated conversation transcript, extract long-term user-relevant facts.

For each fact worth remembering, call the \`memory\` tool:
{ "text": "...", "timestamps": [0] }

One fact per call. If nothing is worth remembering, reply: NONE
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

/**
 * Ensure root-level memory extraction template files exist:
 * - _system_memory_extract.md (committed default)
 * - _system_memory_extract.local.md (gitignored local override, initialized from base)
 */
export function ensureSystemMemoryExtractTemplateFiles(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  createdTemplate: boolean;
  createdLocal: boolean;
} {
  const templatePath = path.join(rootDir, SYSTEM_MEMORY_EXTRACT_TEMPLATE_FILE);
  const localPath = path.join(rootDir, SYSTEM_MEMORY_EXTRACT_TEMPLATE_LOCAL_FILE);

  let createdTemplate = false;
  let createdLocal = false;

  if (!fs.existsSync(templatePath)) {
    try {
      fs.writeFileSync(templatePath, DEFAULT_SYSTEM_MEMORY_EXTRACT_TEMPLATE_FILE_CONTENT, { encoding: "utf-8", flag: "wx" });
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

export function readSystemMemoryExtractTemplate(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  text: string;
  source: "local" | "base" | "none";
} {
  const templatePath = path.join(rootDir, SYSTEM_MEMORY_EXTRACT_TEMPLATE_FILE);
  const localPath = path.join(rootDir, SYSTEM_MEMORY_EXTRACT_TEMPLATE_LOCAL_FILE);

  const localText = tryReadText(localPath);
  if (localText !== null) return { rootDir, templatePath, localPath, text: localText, source: "local" };

  const baseText = tryReadText(templatePath);
  if (baseText !== null) return { rootDir, templatePath, localPath, text: baseText, source: "base" };

  return { rootDir, templatePath, localPath, text: "", source: "none" };
}

export function renderSystemMemoryExtractTemplate(
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
