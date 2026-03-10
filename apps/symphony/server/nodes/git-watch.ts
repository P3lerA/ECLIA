/**
 * git-watch — Source node.
 *
 * Polls a local git repository for new commits and emits each one.
 * Tracks the last-seen commit SHA in node state so it survives restarts.
 *
 * Output ports:
 *   commit : object — { sha, author, date, message, diff? }
 *
 * Config:
 *   repoPath     — absolute path to the git workspace
 *   branch       — branch to watch (default: current HEAD)
 *   pollInterval — seconds between checks (default: 30)
 *   includeDiff  — include diff stat in output (default: false)
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { NodeFactory, SourceNodeContext } from "../types.js";

const execFileAsync = promisify(execFile);

/** Augmented PATH so git is found even when spawned from IDE/service contexts. */
const augmentedEnv = (() => {
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const path = process.env.PATH ?? "";
  const missing = extra.filter((p) => !path.split(":").includes(p));
  if (missing.length === 0) return undefined; // use default
  return { ...process.env, PATH: `${path}:${missing.join(":")}` };
})();

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
    ...(augmentedEnv && { env: augmentedEnv }),
  });
  return stdout.trim();
}

export const factory: NodeFactory = {
  kind: "git-watch",
  label: "Git Watch",
  role: "source",
  description: "Watch a local git repo for new commits.",

  inputPorts: [],
  outputPorts: [
    { key: "commit", label: "Commit", type: "object", objectKeys: { sha: "string", author: "string", date: "string", message: "string", diff: "string" } },
  ],

  configSchema: [
    { key: "repoPath", label: "Repo Path", type: "string", required: true, placeholder: "/home/user/project" },
    { key: "branch", label: "Branch", type: "string", default: "", placeholder: "HEAD (default)" },
    { key: "pollInterval", label: "Poll Interval (s)", type: "number", default: 30 },
    { key: "includeDiff", label: "Include diff stats", type: "boolean", default: false },
  ],

  create(id, config) {
    let timer: ReturnType<typeof setInterval> | null = null;

    return {
      role: "source" as const,
      id,
      kind: "git-watch",

      async start(ctx: SourceNodeContext) {
        const repoPath = String(config.repoPath ?? "").replace(/^~(?=\/|$)/, homedir());
        const branch = String(config.branch ?? "").trim();
        const interval = Math.max(5, Number(config.pollInterval ?? 30)) * 1000;
        const includeDiff = Boolean(config.includeDiff);

        if (!repoPath) throw new Error("[git-watch] repoPath is required");

        const ref = branch || "HEAD";

        // Resolve initial cursor from state or current HEAD
        let lastSha = await ctx.state.get("lastSha") as string | null;
        if (!lastSha) {
          lastSha = await git(repoPath, ["rev-parse", ref]);
          await ctx.state.set("lastSha", lastSha);
          ctx.log.info(`[git-watch] Initialized at ${lastSha.slice(0, 8)} on ${ref}`);
        } else {
          ctx.log.info(`[git-watch] Resuming from ${lastSha.slice(0, 8)} on ${ref}`);
        }

        const poll = async () => {
          try {
            // Fetch from remote (best-effort, works without remote too)
            await git(repoPath, ["fetch", "--quiet"]).catch(() => {});

            const currentSha = await git(repoPath, ["rev-parse", ref]);
            if (currentSha === lastSha) return;

            // Get new commits (oldest first)
            const logFmt = "%H%n%an%n%aI%n%s";
            const raw = await git(repoPath, [
              "log", `${lastSha}..${currentSha}`, `--format=${logFmt}`, "--reverse",
            ]);
            if (!raw) return;

            const lines = raw.split("\n");
            for (let i = 0; i + 3 < lines.length; i += 4) {
              const sha = lines[i];
              const author = lines[i + 1];
              const date = lines[i + 2];
              const message = lines[i + 3];

              const commit: Record<string, unknown> = { sha, author, date, message };

              if (includeDiff) {
                try {
                  commit.diff = await git(repoPath, ["diff", "--stat", `${sha}~1`, sha]);
                } catch { /* first commit or shallow clone */ }
              }

              ctx.emit({ commit });
            }

            lastSha = currentSha;
            await ctx.state.set("lastSha", lastSha);
          } catch (err) {
            ctx.log.error("[git-watch] Poll error:", (err as Error).message);
          }
        };

        // Initial check + interval
        await poll();
        timer = setInterval(poll, interval);
      },

      async stop() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      },
    };
  },
};
