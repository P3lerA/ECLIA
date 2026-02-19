import type { SystemInstructionPart } from "./systemInstruction.js";

import { discoverSkills, readSkillsSystemBlurb, type SkillInfo } from "../skills/registry.js";

function formatEnabledSkills(enabled: SkillInfo[]): string {
  if (enabled.length === 0) return "(none)";
  return enabled
    .map((s) => {
      const summary = s.summary ? ` — ${s.summary}` : "";
      return `- ${s.name}${summary}`;
    })
    .join("\n");
}

export function buildSkillsInstructionPart(rootDir: string, enabledSkillNames: string[]): SystemInstructionPart {
  const available = discoverSkills(rootDir);
  const byName = new Map<string, SkillInfo>(available.map((s) => [s.name, s]));

  const enabled: SkillInfo[] = [];
  for (const name of enabledSkillNames) {
    const s = byName.get(name);
    if (!s) continue;
    enabled.push(s);
  }

  const blurbFromFile = readSkillsSystemBlurb(rootDir);
  const blurb =
    blurbFromFile.trim().length > 0
      ? blurbFromFile.trim()
      : "Skills are optional capability packs. Enabled skills are listed below. For full instructions, read $ECLIA_SKILLS_DIR/<name>/skill.md.";

  const content = [`[Skills]`, blurb, `Enabled skills:\n${formatEnabledSkills(enabled)}`].join("\n\n");

  return {
    id: "skills",
    source: "skills",
    priority: 150,
    content
  };
}
