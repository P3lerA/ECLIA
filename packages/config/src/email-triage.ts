import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./root.js";

const TRIAGE_BASE_FILE = path.join("plugins", "listener", "email", "_triage.md");
const TRIAGE_LOCAL_FILE = path.join("plugins", "listener", "email", "_triage.local.md");

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
 * Ensure plugin triage prompt files exist:
 * - plugins/listener/email/_triage.md (committed base template)
 * - plugins/listener/email/_triage.local.md (gitignored local override, initialized from base)
 */
export function ensureEmailTriageFiles(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  basePath: string;
  localPath: string;
  createdLocal: boolean;
} {
  const basePath = path.join(rootDir, TRIAGE_BASE_FILE);
  const localPath = path.join(rootDir, TRIAGE_LOCAL_FILE);
  let createdLocal = false;

  if (!fs.existsSync(localPath)) {
    try {
      const base = tryReadText(basePath) ?? "";
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, base, { encoding: "utf-8", flag: "wx" });
      createdLocal = true;
    } catch {
      // best-effort
    }
  }

  return { rootDir, basePath, localPath, createdLocal };
}

export function readEmailTriagePrompt(rootDir: string = findProjectRoot(process.cwd())): {
  rootDir: string;
  basePath: string;
  localPath: string;
  text: string;
  source: "local" | "base" | "none";
} {
  const basePath = path.join(rootDir, TRIAGE_BASE_FILE);
  const localPath = path.join(rootDir, TRIAGE_LOCAL_FILE);

  const localText = tryReadText(localPath);
  if (localText !== null) return { rootDir, basePath, localPath, text: localText, source: "local" };

  const baseText = tryReadText(basePath);
  if (baseText !== null) return { rootDir, basePath, localPath, text: baseText, source: "base" };

  return { rootDir, basePath, localPath, text: "", source: "none" };
}

export function writeEmailTriagePromptLocal(rootDir: string, text: string): void {
  const { localPath } = ensureEmailTriageFiles(rootDir);
  try {
    fs.writeFileSync(localPath, String(text ?? ""), "utf-8");
  } catch {
    // best-effort
  }
}
