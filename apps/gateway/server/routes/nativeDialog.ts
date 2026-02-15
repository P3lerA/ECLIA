import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { json } from "../httpUtils.js";

const execFileAsync = promisify(execFile);

export async function handlePickFolder(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

  if (process.platform !== "darwin") {
    return json(res, 400, {
      ok: false,
      error: "unsupported_platform",
      hint: "Folder picker is currently supported only on macOS. Enter a path manually."
    });
  }

  try {
    const script = 'POSIX path of (choose folder with prompt "Select a directory")';
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 60_000 });
    const p = String(stdout ?? "").trim();
    if (!p) return json(res, 200, { ok: false, error: "cancelled" });
    return json(res, 200, { ok: true, path: p });
  } catch (e: any) {
    const msg = String(e?.stderr ?? e?.message ?? "");
    // osascript returns a non-zero exit code on cancel.
    if (/cancel(l)?ed/i.test(msg)) return json(res, 200, { ok: false, error: "cancelled" });
    return json(res, 500, { ok: false, error: "pick_failed", hint: msg || "Failed to open folder picker." });
  }
}
