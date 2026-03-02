import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

export type EmbeddingsSidecarHandle = {
  host: string;
  port: number;
  model: string;
  baseUrl: string;
  process: ReturnType<typeof spawn>;
  stop: () => void;
};

/**
 * Resolve the Python executable to use for the sidecar.
 *
 * Priority:
 *  1. ECLIA_PYTHON env var (explicit override)
 *  2. .venv inside the sidecar directory (created by: python3 -m venv .venv)
 *  3. System python3 / python
 */
export function pickPythonCmd(sidecarDir: string): string {
  const explicit = String(process.env.ECLIA_PYTHON ?? "").trim();
  if (explicit) return explicit;

  // Prefer the local venv if it exists.
  const venvPython = process.platform === "win32"
    ? path.join(sidecarDir, ".venv", "Scripts", "python.exe")
    : path.join(sidecarDir, ".venv", "bin", "python3");

  if (fs.existsSync(venvPython)) return venvPython;

  return process.platform === "win32" ? "python" : "python3";
}

/**
 * Best-effort spawn of the local embeddings sidecar.
 *
 * This should never crash the memory service.
 */
export function spawnEmbeddingsSidecar(args: {
  rootDir: string;
  model: string;
  host: string;
  port: number;
}): EmbeddingsSidecarHandle | null {
  const model = String(args.model ?? "").trim();
  if (!model) return null;

  const host = String(args.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = Number.isFinite(args.port) ? Math.trunc(args.port) : 8789;

  const sidecarDir = path.join(args.rootDir, "apps", "memory", "sidecar");
  const python = pickPythonCmd(sidecarDir);

  const child = spawn(python, ["server.py"], {
    cwd: sidecarDir,
    env: {
      ...process.env,
      ECLIA_EMBEDDINGS_MODEL: model,
      ECLIA_EMBEDDINGS_HOST: host,
      ECLIA_EMBEDDINGS_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const prefix = "[embeddings] ";

  child.stdout?.on("data", (buf) => {
    try { process.stdout.write(prefix + String(buf)); } catch { /* ignore */ }
  });

  child.stderr?.on("data", (buf) => {
    try { process.stderr.write(prefix + String(buf)); } catch { /* ignore */ }
  });

  child.on("error", (err) => {
    console.warn(`[memory] embeddings sidecar failed to spawn (${python}): ${String((err as any)?.message ?? err)}`);
  });

  child.on("exit", (code, signal) => {
    const suffix = signal ? ` signal=${signal}` : "";
    if (code !== 0) {
      console.warn(`[memory] embeddings sidecar exited code=${code ?? "?"}${suffix}`);
      if (code === 1) {
        console.warn(`[memory] hint: Python dependencies may not be installed. Run:\n  python3 -m venv apps/memory/sidecar/.venv\n  apps/memory/sidecar/.venv/bin/pip install -r apps/memory/sidecar/requirements.txt`);
      }
    }
  });

  const stop = () => {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
  };

  process.once("exit", stop);
  process.once("SIGINT", () => { stop(); process.exit(0); });
  process.once("SIGTERM", () => { stop(); process.exit(0); });

  const baseUrl = `http://${host}:${port}`;
  console.log(`[memory] embeddings sidecar spawning: ${baseUrl} model=${model} python=${python}`);

  return { host, port, model, baseUrl, process: child, stop };
}

/**
 * Wait for the sidecar to respond on /health.
 * Returns true if ready within the timeout, false otherwise.
 */
export async function waitForSidecar(baseUrl: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1_500);
      const resp = await fetch(`${baseUrl}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (resp.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
