import fsp from "node:fs/promises";

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fsp.rename(tmp, filePath);
}

export async function removeFile(filePath: string): Promise<void> {
  try { await fsp.unlink(filePath); } catch { /* ignore */ }
}
