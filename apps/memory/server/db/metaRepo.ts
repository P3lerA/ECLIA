import type { Client } from "@libsql/client";
import { getMeta, setMeta } from "./openAndMigrate.js";

export const META_KEY_EMBEDDINGS_MODEL = "embeddings_model";
export const META_KEY_EMBEDDINGS_DIM = "embeddings_dim";

export type MetaEmbeddingsInfo = {
  model: string | null;
  dim: number | null;
};

export async function getEmbeddingsMeta(client: Client): Promise<MetaEmbeddingsInfo> {
  const model = await getMeta(client, META_KEY_EMBEDDINGS_MODEL);
  const dimRaw = await getMeta(client, META_KEY_EMBEDDINGS_DIM);
  const dim = dimRaw !== null ? Number(dimRaw) : null;
  return {
    model,
    dim: dim !== null && Number.isFinite(dim) && dim > 0 ? dim : null
  };
}

export async function setEmbeddingsMeta(client: Client, model: string, dim: number): Promise<void> {
  await setMeta(client, META_KEY_EMBEDDINGS_MODEL, model);
  await setMeta(client, META_KEY_EMBEDDINGS_DIM, String(dim));
}

/** Write meta only if it has never been written (fresh DB). */
export async function writeMetaIfNeeded(client: Client, model: string, dim: number): Promise<void> {
  if (dim <= 0) return;
  const meta = await getEmbeddingsMeta(client);
  if (meta.model === null) {
    await setEmbeddingsMeta(client, model, dim);
    console.log(`[memory] meta lazily initialized: model=${model} dim=${dim}`);
  }
}
