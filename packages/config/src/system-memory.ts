import { findProjectRoot } from "./root.js";
import { renderSystemInstructionTemplate } from "./system-instruction.js";
import { ensureTemplateFiles, readTemplate } from "./template-utils.js";

const SYSTEM_MEMORY_TEMPLATE_FILE = "_system_memory.md";
const SYSTEM_MEMORY_TEMPLATE_LOCAL_FILE = "_system_memory.local.md";

const PLACEHOLDER_MEMORY_PROFILE = "{{MEMORY_PROFILE}}";

const DEFAULT_SYSTEM_MEMORY_TEMPLATE_FILE_CONTENT = `## About the user

{{MEMORY_PROFILE}}
`;

/**
 * Ensure root-level memory injection template files exist:
 * - _system_memory.md (committed default)
 * - _system_memory.local.md (gitignored local override, initialized from base)
 */
export function ensureSystemMemoryTemplateFiles(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  createdTemplate: boolean;
  createdLocal: boolean;
} {
  const result = ensureTemplateFiles(
    rootDir,
    SYSTEM_MEMORY_TEMPLATE_FILE,
    SYSTEM_MEMORY_TEMPLATE_LOCAL_FILE,
    DEFAULT_SYSTEM_MEMORY_TEMPLATE_FILE_CONTENT
  );
  return { rootDir, ...result };
}

export function readSystemMemoryTemplate(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  text: string;
  source: "local" | "base" | "none";
} {
  const result = readTemplate(rootDir, SYSTEM_MEMORY_TEMPLATE_FILE, SYSTEM_MEMORY_TEMPLATE_LOCAL_FILE);
  return { rootDir, ...result };
}

export function renderSystemMemoryTemplate(
  template: string,
  vars: {
    memoryProfile: string;
    userPreferredName?: string;
    assistantName?: string;
  }
): string {
  const base = renderSystemInstructionTemplate(String(template ?? ""), {
    userPreferredName: vars.userPreferredName,
    assistantName: vars.assistantName
  });

  return base.replaceAll(PLACEHOLDER_MEMORY_PROFILE, String(vars.memoryProfile ?? ""));
}
