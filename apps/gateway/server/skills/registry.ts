import fs from "node:fs";
import path from "node:path";

export type SkillInfo = {
  /**
   * Skill id / registration name.
   *
   * IMPORTANT: this MUST equal the directory name under <repo>/skills/<name>/.
   */
  name: string;

  /** One-line summary (derived from skill.md). */
  summary: string;

  /** Repo-relative directory path, posix style. Example: "skills/pdfs" */
  dirRel: string;

  /** Repo-relative skill doc path, posix style. Example: "skills/pdfs/skill.md" */
  skillMdRel: string;
};

function readUtf8IfExists(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    const st = fs.statSync(p);
    if (!st.isFile()) return null;
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Extract a single-line summary from a skill.md.
 *
 * Convention (recommended):
 * - First non-empty line is a title (e.g. "# pdfs")
 * - First non-empty, non-heading line is the summary.
 */
export function extractSkillSummaryFromMarkdown(mdText: string): string {
  const txt = String(mdText ?? "").replace(/^\uFEFF/, ""); // strip BOM
  const lines = txt.split(/\r?\n/);

  let title: string | null = null;
  let summary: string | null = null;

  for (const raw of lines) {
    const s = raw.trim();
    if (!s) continue;

    // Title heading
    if (!title && /^#{1,6}\s+/.test(s)) {
      title = s.replace(/^#{1,6}\s+/, "").trim();
      continue;
    }

    // First real content line as summary
    summary = s;
    break;
  }

  const one = (summary ?? title ?? "").replace(/\s+/g, " ").trim();
  if (!one) return "";

  // Keep it short for system prompt injection.
  const MAX = 180;
  if (one.length <= MAX) return one;
  return one.slice(0, MAX - 1).trimEnd() + "…";
}

export function discoverSkills(rootDir: string): SkillInfo[] {
  const skillsRoot = path.join(rootDir, "skills");

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: SkillInfo[] = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = String(ent.name ?? "").trim();
    if (!name || name.startsWith(".")) continue;

    const dirAbs = path.join(skillsRoot, name);
    const skillMdAbs = path.join(dirAbs, "skill.md");
    const md = readUtf8IfExists(skillMdAbs);
    if (md === null) continue;

    const summary = extractSkillSummaryFromMarkdown(md);

    // Always use posix separators in any data that might be injected into prompts.
    const dirRel = path.posix.join("skills", name);
    const skillMdRel = path.posix.join("skills", name, "skill.md");

    out.push({ name, summary, dirRel, skillMdRel });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export type ValidateEnabledSkillsResult =
  | { ok: true; enabled: string[] }
  | { ok: false; error: string; hint?: string };

/**
 * Validate skill names from config/UI against the discovered skills.
 *
 * Strict requirement:
 * - All skill names MUST exactly match the directory name under <repo>/skills/<name>/.
 */
export function validateEnabledSkills(enabledRaw: unknown, available: SkillInfo[]): ValidateEnabledSkillsResult {
  const raw = Array.isArray(enabledRaw) ? enabledRaw : [];

  const availableSet = new Set<string>(available.map((s) => s.name));

  const out: string[] = [];
  const seen = new Set<string>();

  for (const x of raw) {
    const name = typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "";
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    if (!availableSet.has(name)) {
      return {
        ok: false,
        error: "unknown_skill",
        hint: `Unknown skill '${name}'. Skill names must exactly match an existing directory under skills/<name>/ (case-sensitive).`
      };
    }

    out.push(name);
  }

  return { ok: true, enabled: out };
}

/**
 * Optional system-wide blurb injected into the system instruction.
 *
 * If present, create this file and keep it SHORT:
 *   <repo>/skills/_system.md
 */
export function readSkillsSystemBlurb(rootDir: string): string {
  const p = path.join(rootDir, "skills", "_system.md");
  const txt = readUtf8IfExists(p);
  if (!txt) return "";

  // Keep it brief by default (avoid accidental huge injections).
  const MAX = 2_000;
  const trimmed = txt.trim();
  if (trimmed.length <= MAX) return trimmed;
  return trimmed.slice(0, MAX - 1).trimEnd() + "…";
}
