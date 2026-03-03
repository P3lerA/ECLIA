import { randomUUID } from "node:crypto";

export type { ManagedMemoryDto, MemoryDb, RecallMemoryDto } from "./db/types.js";
export { R_DIM } from "./db/vector.js";
export { openMemoryDb } from "./db/openAndMigrate.js";
export { createFact, deleteFact, listFactsManage, updateFact } from "./db/factRepo.js";
export { logActivation, makeFactNodeId, recallFacts } from "./db/recallRepo.js";

export function makeRandomRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `req_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}
