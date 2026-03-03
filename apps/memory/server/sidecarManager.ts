import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  spawnEmbeddingsSidecar,
  waitForSidecar,
  type EmbeddingsSidecarHandle
} from "./embeddingsSidecar.js";

export type SidecarManager = {
  ensureSidecar: (model: string) => Promise<string | null>;
  getSidecar: () => EmbeddingsSidecarHandle | null;
};

type CreateSidecarManagerArgs = {
  rootDir: string;
  defaultModel: string;
  host: string;
  port: number;
};

export function createSidecarManager(args: CreateSidecarManagerArgs): SidecarManager {
  const host = String(args.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = Number.isFinite(args.port) ? Math.trunc(args.port) : 8789;
  const defaultModel = String(args.defaultModel ?? "").trim();

  let sidecar = spawnEmbeddingsSidecar({
    rootDir: args.rootDir,
    model: defaultModel,
    host,
    port
  });

  let sidecarSpawning = false;
  async function ensureSidecar(modelName: string): Promise<string | null> {
    if (sidecar) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1_500);
      try {
        const r = await fetch(`${sidecar.baseUrl}/health`, { signal: ctrl.signal });
        if (r.ok) return sidecar.baseUrl;
      } catch {
        // fell through — sidecar died, respawn below
      } finally {
        clearTimeout(timer);
      }
    }

    if (sidecarSpawning) {
      const deadline = Date.now() + 30_000;
      while (sidecarSpawning && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
      }
      return sidecar?.baseUrl ?? null;
    }

    sidecarSpawning = true;
    try {
      const handle = spawnEmbeddingsSidecar({
        rootDir: args.rootDir,
        model: modelName || defaultModel || "all-MiniLM-L6-v2",
        host,
        port
      });
      if (!handle) return null;
      sidecar = handle;
      const ready = await waitForSidecar(handle.baseUrl, 30_000);
      if (!ready) {
        console.warn("[memory] sidecar did not become ready within 30s — Python deps may be missing");
        return null;
      }
      return handle.baseUrl;
    } finally {
      sidecarSpawning = false;
    }
  }

  return {
    ensureSidecar,
    getSidecar: () => sidecar
  };
}

function hfCacheDir(): string {
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  const hfHome = process.env.HF_HOME ?? path.join(os.homedir(), ".cache", "huggingface");
  return path.join(hfHome, "hub");
}

export function isModelCached(modelName: string): boolean {
  function check(name: string): boolean {
    const safeName = "models--" + name.replace(/\//g, "--");
    const snapshotsDir = path.join(hfCacheDir(), safeName, "snapshots");
    try {
      return fs.readdirSync(snapshotsDir).length > 0;
    } catch {
      return false;
    }
  }

  if (check(modelName)) return true;
  if (!modelName.includes("/")) return check(`sentence-transformers/${modelName}`);
  return false;
}

export async function proxySidecar(
  sidecarBaseUrl: string | null,
  endpointPath: string,
  init: { method: string; body?: string; timeoutMs?: number }
): Promise<{ ok: boolean; status: number; data: any } | null> {
  if (!sidecarBaseUrl) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 120_000);

  try {
    const resp = await fetch(`${sidecarBaseUrl}${endpointPath}`, {
      method: init.method,
      headers: init.body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
      body: init.body,
      signal: ctrl.signal
    });
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
