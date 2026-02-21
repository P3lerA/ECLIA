import type { SystemInstructionPart } from "./systemInstruction.js";

import { discoverSkills, readSkillsSystemBlurb } from "../skills/registry.js";

const PLACEHOLDER_ENABLED_SKILLS = "{{ENABLED_SKILLS}}";
const PLACEHOLDER_ACTIVATED_SKILLS = "{{ACTIVATED_SKILLS}}";

export function buildSkillsInstructionPart(rootDir: string, enabledSkillNames: string[]): SystemInstructionPart {
  // NOTE: We avoid hardcoding any *boilerplate* (headings, labels) in code.
  // The only dynamic injection we do is rendering enabled skill summaries into a user-provided
  // template under skills/_system.md.
  //
  // Supported placeholders:
  // - {{ACTIVATED_SKILLS}}
  // - {{ENABLED_SKILLS}}
  //
  // If neither placeholder is present, we do NOT inject anything.

  // Optional: user-provided skills system blurb (lives under skills/_system.md).
  const blurb = readSkillsSystemBlurb(rootDir).trim();

  let content = blurb;

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
