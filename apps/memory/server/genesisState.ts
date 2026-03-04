import { randomUUID } from "node:crypto";

export type GenesisRunStage = "idle" | "stage1_extract" | "stage2_consolidate" | "done" | "error";

export type GenesisRunStatus = {
  id: string;
  stage: GenesisRunStage;
  startedAt: string;
  updatedAt: string;
  processedSessions: number;
  processedChunks: number;
  extractedFacts: number;
  error?: string;
};

export type GenesisState = {
  isRunning: () => boolean;
  start: () => GenesisRunStatus;
  setStage: (stage: GenesisRunStage) => void;
  noteProcessedSession: (n?: number) => void;
  noteProcessedChunk: (n?: number) => void;
  noteExtracted: (n?: number) => void;
  finishOk: () => void;
  finishError: (err: unknown) => void;
  status: () => { active: GenesisRunStatus | null; last: GenesisRunStatus | null };
};

function isoNow(): string {
  return new Date().toISOString();
}

function safeId(): string {
  try {
    return randomUUID();
  } catch {
    return `gen_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}

function asErrString(err: unknown): string {
  if (!err) return "unknown_error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "error";
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function createGenesisState(): GenesisState {
  let active: GenesisRunStatus | null = null;
  let last: GenesisRunStatus | null = null;

  const bump = () => {
    if (!active) return;
    active.updatedAt = isoNow();
  };

  return {
    isRunning: () => active !== null && active.stage !== "done" && active.stage !== "error",

    start: () => {
      if (active) throw new Error("genesis_already_running");
      active = {
        id: safeId(),
        stage: "stage1_extract",
        startedAt: isoNow(),
        updatedAt: isoNow(),
        processedSessions: 0,
        processedChunks: 0,
        extractedFacts: 0
      };
      return active;
    },

    setStage: (stage) => {
      if (!active) return;
      active.stage = stage;
      bump();
    },

    noteProcessedSession: (n = 1) => {
      if (!active) return;
      active.processedSessions += Math.max(0, Math.trunc(n));
      bump();
    },

    noteProcessedChunk: (n = 1) => {
      if (!active) return;
      active.processedChunks += Math.max(0, Math.trunc(n));
      bump();
    },

    noteExtracted: (n = 1) => {
      if (!active) return;
      active.extractedFacts += Math.max(0, Math.trunc(n));
      bump();
    },

    finishOk: () => {
      if (!active) return;
      active.stage = "done";
      bump();
      last = active;
      active = null;
    },

    finishError: (err: unknown) => {
      if (!active) {
        last = {
          id: safeId(),
          stage: "error",
          startedAt: isoNow(),
          updatedAt: isoNow(),
          processedSessions: 0,
          processedChunks: 0,
          extractedFacts: 0,
          error: asErrString(err)
        };
        return;
      }
      active.stage = "error";
      active.error = asErrString(err);
      bump();
      last = active;
      active = null;
    },

    status: () => ({ active, last })
  };
}
