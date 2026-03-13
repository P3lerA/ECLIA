import type { SystemInstructionPart } from "./systemInstruction.js";

import { readSystemSkillsTemplate } from "@eclia/config";
import { discoverSkills, ensureSkillUserDoc } from "../skills/registry.js";

const PLACEHOLDER_ENABLED_SKILLS = "{{ENABLED_SKILLS}}";
const PLACEHOLDER_ACTIVATED_SKILLS = "{{ACTIVATED_SKILLS}}";

export function buildSkillsInstructionPart(rootDir: string, enabledSkillNames: string[]): SystemInstructionPart {
  // Best-effort ensure user-editable skill docs exist for enabled skills.
  // This keeps the on-disk skill docs ready before the model tries to read them.
  for (const nameRaw of enabledSkillNames ?? []) {
    const name = String(nameRaw ?? "").trim();
    if (!name) continue;
    ensureSkillUserDoc(rootDir, name);
  }

  // Read skills template from _system_skills.local.md → _system_skills.md fallback.
  const { text: blurb } = readSystemSkillsTemplate(rootDir);
  let content = blurb.trim();

  const hasPlaceholder =
    content.includes(PLACEHOLDER_ACTIVATED_SKILLS) || content.includes(PLACEHOLDER_ENABLED_SKILLS);

  if (hasPlaceholder) {
    const available = discoverSkills(rootDir);
    const byName = new Map<string, string>();
    for (const s of available) byName.set(s.name, s.summary);

    const lines: string[] = [];
    for (const nameRaw of enabledSkillNames ?? []) {
      const name = String(nameRaw ?? "").trim();
      if (!name) continue;
      const summary = (byName.get(name) ?? "").trim();
      lines.push(summary ? `- ${name} — ${summary}` : `- ${name}`);
    }
    const rendered = lines.length ? lines.join("\n") : "- (none)";

    content = content
      .replaceAll(PLACEHOLDER_ACTIVATED_SKILLS, rendered)
      .replaceAll(PLACEHOLDER_ENABLED_SKILLS, rendered);
  }

  return {
    id: "skills",
    source: "skills",
    priority: 150,
    content
  };
}
