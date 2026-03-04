import type { Client } from "@libsql/client";
import { embedTexts, getEmbeddingsHealth } from "./embeddingClient.js";
import { toVectorJson } from "./db/vector.js";
import { setEmbeddingsMeta } from "./db/metaRepo.js";

const BATCH_SIZE = 64;

export type ReembedArgs = {
  client: Client;
  sidecarBaseUrl: string;
  model: string;
  timeoutMs?: number;
};

export async function reembedAllFacts(
  args: ReembedArgs
): Promise<{ total: number; embedded: number; dim: number }> {
  const { client, sidecarBaseUrl, model } = args;
  const timeoutMs = args.timeoutMs ?? 30_000;

  const res = await client.execute(
    "SELECT node_id, raw FROM Fact WHERE raw IS NOT NULL AND raw != '';"
  );
  const facts = res.rows
    .map((r: any) => ({ id: Number(r.node_id), raw: String(r.raw ?? "") }))
    .filter((f) => f.raw.trim());

  if (facts.length === 0) {
    console.log("[memory] re-embed: no facts to process");
    const health = await getEmbeddingsHealth({ baseUrl: sidecarBaseUrl, timeoutMs: 5_000 });
    const dim = health?.dim ?? 0;
    if (dim > 0) await setEmbeddingsMeta(client, model, dim);
    return { total: 0, embedded: 0, dim };
  }

  console.log(`[memory] re-embed: ${facts.length} facts in batches of ${BATCH_SIZE}`);

  let embedded = 0;
  let dim = 0;

  for (let i = 0; i < facts.length; i += BATCH_SIZE) {
    const batch = facts.slice(i, i + BATCH_SIZE);
    const texts = batch.map((f) => f.raw);

    const result = await embedTexts({ baseUrl: sidecarBaseUrl, texts, timeoutMs });

    if (!result || result.vectors.length !== batch.length) {
      throw new Error(
        `[memory] re-embed: batch ${Math.floor(i / BATCH_SIZE) + 1} failed ` +
        `(expected ${batch.length} vectors, got ${result?.vectors?.length ?? 0})`
      );
    }

    if (dim === 0) {
      dim = result.dim;
    } else if (result.dim !== dim) {
      throw new Error(
        `[memory] re-embed: dimension mismatch! expected=${dim} got=${result.dim}`
      );
    }

    for (let j = 0; j < batch.length; j++) {
      const sJson = toVectorJson(result.vectors[j]);
      await client.execute({
        sql: "UPDATE Fact SET vector_S = vector32(?) WHERE node_id = ?;",
        args: [sJson, batch[j].id]
      });
    }

    embedded += batch.length;
    console.log(
      `[memory] re-embed: ${embedded}/${facts.length} (batch ${Math.floor(i / BATCH_SIZE) + 1})`
    );
  }

  if (dim > 0) {
    await setEmbeddingsMeta(client, model, dim);
    console.log(`[memory] re-embed: done. model=${model} dim=${dim} embedded=${embedded}/${facts.length}`);
  }

  return { total: facts.length, embedded, dim };
}
