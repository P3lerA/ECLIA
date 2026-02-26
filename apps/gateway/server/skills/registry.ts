import fs from "node:fs";
import path from "node:path";

export type SkillInfo = {
  /**
   * Skill id / registration name.
   *
   * IMPORTANT: this MUST equal the directory name under <repo>/skills/<name>/.
   */
  name: string;

  /** One-line summary (derived from the template markdown). */
  summary: string;

  /** Repo-relative directory path, posix style. Example: "skills/pdfs" */
  dirRel: string;

  /** Repo-relative template markdown path, posix style. Example: "skills/pdfs/_template/SKILL.template.md" */
  templateMdRel: string;

  /** Repo-relative user skill doc path, posix style. Example: "skills/pdfs/SKILL.md" */
  userSkillMdRel: string;

  /**
   * Repo-relative compatibility skill doc path, posix style.
   *
   * NOTE: The default Skills system prompt currently points to skills/<name>/skill.md.
   * We generate/refresh this file from SKILL.md when a skill is enabled.
   */
  compatSkillMdRel: string;
};

const SKILL_TEMPLATE_REL = path.join("_template", "SKILL.template.md");
const SKILL_USER_DOC = "SKILL.md";
const SKILL_COMPAT_DOC = "skill.md";

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
    if (!name || name.startsWith(".") || name.startsWith("_")) continue;

    const dirAbs = path.join(skillsRoot, name);
    const templateAbs = path.join(dirAbs, SKILL_TEMPLATE_REL);
    const legacySkillMdAbs = path.join(dirAbs, SKILL_COMPAT_DOC);

    // Prefer the new template location. Fall back to legacy skills/<name>/skill.md for back-compat.
    const md = readUtf8IfExists(templateAbs) ?? readUtf8IfExists(legacySkillMdAbs);
    if (md === null) continue;

    const summary = extractSkillSummaryFromMarkdown(md);

    // Always use posix separators in any data that might be injected into prompts.
    const dirRel = path.posix.join("skills", name);

    const templateMdRel = path.posix.join("skills", name, "_template", "SKILL.template.md");
    const userSkillMdRel = path.posix.join("skills", name, "SKILL.md");
    const compatSkillMdRel = path.posix.join("skills", name, "skill.md");

    out.push({ name, summary, dirRel, templateMdRel, userSkillMdRel, compatSkillMdRel });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Ensure the user-editable skill doc exists for a given skill.
 *
 * Convention:
 * - Template: skills/<name>/_template/SKILL.template.md (tracked)
 * - User doc: skills/<name>/SKILL.md (generated on first enable; user may edit)
 * - Compat doc: skills/<name>/skill.md (generated/overwritten from SKILL.md for current prompts)
 *
 * This is intentionally best-effort: failures should not crash the gateway.
 */
export function ensureSkillUserDoc(
  rootDir: string,
  skillName: string
):
  | {
      ok: true;
      createdUserDoc: boolean;
      refreshedCompatDoc: boolean;
    }
  | {
      ok: false;
      error: string;
      hint?: string;
    } {
  const name = String(skillName ?? "").trim();
  if (!name) return { ok: false, error: "invalid_skill_name" };

  const skillDir = path.join(rootDir, "skills", name);
  const templatePath = path.join(skillDir, SKILL_TEMPLATE_REL);
  const userDocPath = path.join(skillDir, SKILL_USER_DOC);
  const compatDocPath = path.join(skillDir, SKILL_COMPAT_DOC);

  const templateText = readUtf8IfExists(templatePath);
  if (templateText === null) {
    return {
      ok: false,
      error: "missing_skill_template",
      hint: `Missing skill template: ${path.posix.join("skills", name, "_template", "SKILL.template.md")}`
    };
  }

  let createdUserDoc = false;
  if (!fs.existsSync(userDocPath)) {
    try {
      // "wx" = write only if not exists (prevents clobbering user edits)
      fs.writeFileSync(userDocPath, templateText, { encoding: "utf-8", flag: "wx" });
      createdUserDoc = true;
    } catch {
      // best-effort
    }
  }

  // Always refresh compat doc from the user doc (or template fallback).
  const userText = readUtf8IfExists(userDocPath) ?? templateText;
  let refreshedCompatDoc = false;
  try {
    fs.writeFileSync(compatDocPath, userText, { encoding: "utf-8" });
    refreshedCompatDoc = true;
  } catch {
    // best-effort
  }

  return { ok: true, createdUserDoc, refreshedCompatDoc };
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
