import { findProjectRoot } from "./root.js";
import { renderSystemInstructionTemplate } from "./system-instruction.js";
import { ensureTemplateFiles, readTemplate } from "./template-utils.js";

const SYSTEM_SKILLS_TEMPLATE_FILE = "_system_skills.md";
const SYSTEM_SKILLS_TEMPLATE_LOCAL_FILE = "_system_skills.local.md";

const DEFAULT_SYSTEM_SKILLS_TEMPLATE_FILE_CONTENT = `## Skills
- For any relevant skill, read its instructions at \`$ECLIA_SKILLS_DIR/<name>/SKILL.md\`.
- Update SKILL.md as needed (e.g., fill in placeholders like "Remote Server IP: undefined" with user-provided info).
- Don't modify anything beyond what the user or SKILL.md specifies.

Activated Skills:
{{ACTIVATED_SKILLS}}
`;

/**
 * Ensure root-level skills template files exist:
 * - _system_skills.md (committed default)
 * - _system_skills.local.md (gitignored local override, initialized from base)
 */
export function ensureSystemSkillsTemplateFiles(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  createdTemplate: boolean;
  createdLocal: boolean;
} {
  const result = ensureTemplateFiles(
    rootDir,
    SYSTEM_SKILLS_TEMPLATE_FILE,
    SYSTEM_SKILLS_TEMPLATE_LOCAL_FILE,
    DEFAULT_SYSTEM_SKILLS_TEMPLATE_FILE_CONTENT
  );
  return { rootDir, ...result };
}

export function readSystemSkillsTemplate(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  templatePath: string;
  localPath: string;
  text: string;
  source: "local" | "base" | "none";
} {
  const result = readTemplate(rootDir, SYSTEM_SKILLS_TEMPLATE_FILE, SYSTEM_SKILLS_TEMPLATE_LOCAL_FILE);
  return { rootDir, ...result };
}

export function renderSystemSkillsTemplate(
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
