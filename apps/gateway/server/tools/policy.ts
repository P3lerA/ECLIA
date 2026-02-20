import path from "node:path";

export type ToolAccessMode = "full" | "safe";

export type ExecAllowlistRule =
  | { type: "exact"; raw: string; value: string }
  | { type: "regex"; raw: string; re: RegExp };

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseAllowlistRule(raw: string): ExecAllowlistRule | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // Regex form: /pattern/flags
  if (s.startsWith("/") && s.lastIndexOf("/") > 0) {
    const last = s.lastIndexOf("/");
    const pat = s.slice(1, last);
    const flags = s.slice(last + 1);

    try {
      const re = new RegExp(pat, flags);
      return { type: "regex", raw: s, re };
    } catch {
      // fall back to exact match
    }
  }

  return { type: "exact", raw: s, value: s };
}

export function loadExecAllowlist(raw: Record<string, any>): ExecAllowlistRule[] {
  try {
    if (!isRecord(raw)) return [];
    const tools = isRecord(raw.tools) ? raw.tools : {};
    const exec = isRecord((tools as any).exec) ? (tools as any).exec : {};
    const allow = (exec as any).allowlist;

    const arr: string[] = Array.isArray(allow)
      ? allow.filter((x) => typeof x === "string")
      : typeof allow === "string"
        ? [allow]
        : [];

    const rules: ExecAllowlistRule[] = [];
    for (const item of arr) {
      const r = parseAllowlistRule(item);
      if (r) rules.push(r);
    }
    return rules;
  } catch {
    return [];
  }
}

function firstTokenFromShell(command: string): { token: string; complex: boolean } {
  const s = String(command ?? "").trim();
  if (!s) return { token: "", complex: false };

  // Heuristic: if the command contains common shell control operators,
  // treat it as complex (approval recommended in safe mode).
  const complex = /[\n\r;&|<>`]|\$\(|\$\{|\bexec\b/.test(s);

  // Very lightweight tokenization: grab until first whitespace.
  const m = s.match(/^([^\s]+)/);
  const token = m ? m[1] : "";
  return { token, complex };
}

function basenameSafe(p: string): string {
  const s = String(p ?? "").trim();
  if (!s) return "";
  // command might be "./bin/foo" or "/usr/bin/git".
  return path.posix.basename(s.replace(/\\/g, "/"));
}

function matchesAllowlist(commandName: string, allowlist: ExecAllowlistRule[]): string | null {
  const name = String(commandName ?? "").trim();
  if (!name) return null;

  for (const r of allowlist) {
    if (r.type === "exact") {
      if (name === r.value || name === basenameSafe(r.value)) return r.raw;
      continue;
    }

    if (r.type === "regex") {
      try {
        if (r.re.test(name)) return r.raw;
      } catch {
        // ignore
      }
    }
  }

  return null;
}

export function checkExecNeedsApproval(
  execArgs: { command?: string } | any,
  mode: ToolAccessMode,
  allowlist: ExecAllowlistRule[]
): {
  requireApproval: boolean;
  reason: string;
  matchedAllowlist?: string;
} {
  if (mode === "full") {
    return { requireApproval: false, reason: "mode_full" };
  }

  const command = typeof execArgs?.command === "string" ? execArgs.command : "";

  // Missing command: don't ask for approval; it will error anyway.
  if (!command) return { requireApproval: false, reason: "missing_command" };

  // Shell string form
  const parsed = firstTokenFromShell(command);
  const name = basenameSafe(parsed.token);
  if (parsed.complex) {
    return { requireApproval: true, reason: "shell_complex" };
  }
  const matched = matchesAllowlist(name, allowlist);
  if (matched) return { requireApproval: false, reason: "allowlisted", matchedAllowlist: matched };
  return { requireApproval: true, reason: "not_allowlisted" };
}
