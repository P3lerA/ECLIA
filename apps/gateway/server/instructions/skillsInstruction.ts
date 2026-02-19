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

  // Optional: user-provided skills system blurb (kept out of code; lives under skills/_system.md).
  // If omitted/empty, we only inject the enabled-skill list (no default boilerplate).
  const blurbFromFile = readSkillsSystemBlurb(rootDir).trim();

  const sections: string[] = ["[Skills]"];
  if (blurbFromFile) sections.push(blurbFromFile);
  sections.push(`Enabled skills:\n${formatEnabledSkills(enabled)}`);

  const content = sections.join("\n\n");

  return {
    id: "skills",
    source: "skills",
    priority: 150,
    content
  };
}
