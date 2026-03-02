import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./root.js";
import { renderSystemInstructionTemplate } from "./system-instruction.js";

const SYSTEM_MEMORY_TEMPLATE_FILE = "_system_memory.md";
const SYSTEM_MEMORY_TEMPLATE_LOCAL_FILE = "_system_memory.local.md";

// NOTE: This is only used as a fallback when the committed template file is missing.
// Normal usage should rely on the root-level _system_memory.md (committed) and
// _system_memory.local.md (gitignored override).
const DEFAULT_SYSTEM_MEMORY_TEMPLATE_FILE_CONTENT = `Here is some background information about me (the user). Please keep it in mind when responding.

{{RETRIEVED_CONTEXT}}
`;

const PLACEHOLDER_RETRIEVED_CONTEXT = "{{RETRIEVED_CONTEXT}}";

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
 * Ensure root-level memory injection template files exist:
 * - _system_memory.md (committed default)
 * - _system_memory.local.md (gitignored local override, initialized from _system_memory.md)
 */
export function ensureSystemMemoryTemplateFiles(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  createdTemplate: boolean;
  createdLocal: boolean;
} {
  const templatePath = path.join(rootDir, SYSTEM_MEMORY_TEMPLATE_FILE);
  const localPath = path.join(rootDir, SYSTEM_MEMORY_TEMPLATE_LOCAL_FILE);

  let createdTemplate = false;
  let createdLocal = false;

  if (!fs.existsSync(templatePath)) {
    try {
      fs.writeFileSync(templatePath, DEFAULT_SYSTEM_MEMORY_TEMPLATE_FILE_CONTENT, { encoding: "utf-8", flag: "wx" });
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

export function readSystemMemoryTemplate(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  text: string;
  source: "local" | "base" | "none";
} {
  const templatePath = path.join(rootDir, SYSTEM_MEMORY_TEMPLATE_FILE);
  const localPath = path.join(rootDir, SYSTEM_MEMORY_TEMPLATE_LOCAL_FILE);

  const localText = tryReadText(localPath);
  if (localText !== null) return { rootDir, templatePath, localPath, text: localText, source: "local" };

  const baseText = tryReadText(templatePath);
  if (baseText !== null) return { rootDir, templatePath, localPath, text: baseText, source: "base" };

  return { rootDir, templatePath, localPath, text: "", source: "none" };
}

export function renderSystemMemoryTemplate(
  template: string,
  vars: {
    retrievedContext: string;
    userPreferredName?: string;
    assistantName?: string;
  }
): string {
  const base = renderSystemInstructionTemplate(String(template ?? ""), {
    userPreferredName: vars.userPreferredName,
    assistantName: vars.assistantName
  });

  // Allow the template to fully control formatting; we only substitute the raw retrieved context.
  return base.replaceAll(PLACEHOLDER_RETRIEVED_CONTEXT, String(vars.retrievedContext ?? ""));
}
