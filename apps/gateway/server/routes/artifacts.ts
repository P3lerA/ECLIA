import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { json } from "../httpUtils.js";

function guessMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".txt":
    case ".log":
    case ".md":
      return "text/plain; charset=utf-8";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function handleArtifacts(req: http.IncomingMessage, res: http.ServerResponse, rootDir: string) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { ok: false, error: "method_not_allowed" });

  const u = new URL(req.url ?? "/", "http://localhost");
  const rel = u.searchParams.get("path") ?? "";
  if (!rel) return json(res, 400, { ok: false, error: "missing_path" });

  // Normalize path separators (Windows clients may send backslashes).
  const relNorm = rel.replace(/\\/g, "/");

  // Resolve to an absolute path and restrict to <root>/.eclia/artifacts/**.
  const artifactsRoot = path.resolve(rootDir, ".eclia", "artifacts");
  const abs = path.resolve(rootDir, relNorm);

  if (abs !== artifactsRoot && !abs.startsWith(artifactsRoot + path.sep)) {
    return json(res, 403, { ok: false, error: "forbidden" });
  }

  let st: fs.Stats;
  try {
    st = await fsp.stat(abs);
  } catch {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  if (!st.isFile()) return json(res, 404, { ok: false, error: "not_found" });

  const mime = guessMimeFromPath(abs);
  const filename = path.basename(abs);
  const inline = mime.startsWith("image/") || mime.startsWith("text/") || mime === "application/json";

  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", String(st.size));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename}"`);

  if (req.method === "HEAD") {
    res.writeHead(200);
    res.end();
    return;
  }

  res.writeHead(200);
  fs.createReadStream(abs).pipe(res);
}
