import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type GitInfoSnapshot = {
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
};

function runGit(repoRoot: string, args: string[]): { ok: boolean; stdout: string } {
  try {
    const out = spawnSync("git", args, {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 800,
      maxBuffer: 1024 * 1024
    });
    const stdout = String(out.stdout ?? "");
    return { ok: out.status === 0, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

function isLikelyCommitHash(s: string): boolean {
  const t = s.trim();
  return /^[0-9a-f]{7,40}$/i.test(t);
}

function resolveGitDir(repoRoot: string): string | null {
  const dotGit = path.join(repoRoot, ".git");
  try {
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    if (!st.isFile()) return null;

    // Worktree case: .git is a file containing "gitdir: <path>".
    const txt = fs.readFileSync(dotGit, "utf-8");
    const m = String(txt ?? "").trim().match(/^gitdir:\s*(.+)\s*$/i);
    if (!m) return null;
    const p = String(m[1] ?? "").trim();
    if (!p) return null;
    return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
  } catch {
    return null;
  }
}

function readCommitFromGitDir(gitDir: string, refPath: string): string | null {
  // First try loose ref (most common).
  try {
    const p = path.join(gitDir, refPath);
    const txt = fs.readFileSync(p, "utf-8");
    const h = String(txt ?? "").trim();
    if (isLikelyCommitHash(h)) return h;
  } catch {
    // ignore
  }

  // Fallback: packed-refs
  try {
    const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf-8");
    const lines = String(packed ?? "").split(/\r?\n/g);
    for (const line of lines) {
      if (!line || line.startsWith("#") || line.startsWith("^") || line.startsWith("@")) continue;
      const m = line.match(/^([0-9a-f]{7,40})\s+(.+)$/i);
      if (!m) continue;
      const hash = String(m[1] ?? "").trim();
      const ref = String(m[2] ?? "").trim();
      if (ref === refPath && isLikelyCommitHash(hash)) return hash;
    }
  } catch {
    // ignore
  }

  return null;
}

function readGitInfoFromFiles(repoRoot: string): GitInfoSnapshot {
  const gitDir = resolveGitDir(repoRoot);
  if (!gitDir) return { commit: null, branch: null, dirty: null };

  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf-8");
    const headTxt = String(head ?? "").trim();

    // Detached head.
    if (isLikelyCommitHash(headTxt)) return { commit: headTxt.trim(), branch: null, dirty: null };

    // Normal ref.
    const m = headTxt.match(/^ref:\s*(.+)$/i);
    if (!m) return { commit: null, branch: null, dirty: null };
    const refPath = String(m[1] ?? "").trim();
    const branch = refPath.startsWith("refs/heads/") ? refPath.slice("refs/heads/".length) : null;
    const commit = readCommitFromGitDir(gitDir, refPath);
    return { commit, branch, dirty: null };
  } catch {
    return { commit: null, branch: null, dirty: null };
  }
}

/**
 * Best-effort git provenance snapshot.
 *
 * This is used for turn-level transcript metadata so debugging can answer:
 * "What code was running when this turn happened?"
 */
export function readGitInfo(repoRoot: string): GitInfoSnapshot {
  const root = String(repoRoot ?? "").trim();
  if (!root) return { commit: null, branch: null, dirty: null };

  // Preferred path (fast + accurate when `git` is available).
  const st = runGit(root, ["status", "--porcelain", "-b"]);
  const rp = runGit(root, ["rev-parse", "HEAD"]);

  if (st.ok || rp.ok) {
    let branch: string | null = null;
    let dirty: boolean | null = null;

    if (st.ok) {
      const lines = st.stdout.split(/\r?\n/g).filter((l) => l.length);
      const head = lines[0] ?? "";
      if (head.startsWith("## ")) {
        const rest = head.slice(3).trim();
        const name = rest.split("...")[0]?.trim() ?? "";
        if (name && name !== "HEAD" && !/^HEAD\b/.test(name)) branch = name;
      }
      dirty = lines.length > 1;
    }

    const commit = rp.ok && isLikelyCommitHash(rp.stdout.trim()) ? rp.stdout.trim() : null;
    return { commit, branch, dirty };
  }

  // Fallback for environments where `git` is not present (or repo is packaged).
  return readGitInfoFromFiles(root);
}
