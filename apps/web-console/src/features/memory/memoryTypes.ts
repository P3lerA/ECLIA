export type EmbeddingLanguage = "en" | "zh" | "multi";

export type CuratedModel = {
  value: string;
  label: string;
};

export type ModelStatus = "unknown" | "checking" | "cached" | "not_cached" | "downloading" | "deleting" | "error";

export type MemoryBase = {
  enabled: boolean;
  host: string;
  port: number;
  recentTurns: number;
  recallLimit: number;
  recallMinScore: number;
  timeoutMs: number;
  embeddingsModel: string;
  genesisTurnsPerCall: number;
  extractToolMessages: "drop" | "truncate";
  extractToolMaxCharsPerMsg: number;
  extractToolMaxTotalChars: number;
};

export type MemoryDraft = {
  enabled: boolean;
  host: string;
  port: string;
  recentTurns: string;
  recallLimit: string;
  recallMinScore: string;
  timeoutMs: string;
  embeddingsModel: string;
  genesisTurnsPerCall: string;
  extractToolMessages: "drop" | "truncate";
  extractToolMaxCharsPerMsg: string;
  extractToolMaxTotalChars: string;
};

export type MemoryManageItem = {
  id: string;
  raw: string;
  createdAt: number;
  updatedAt: number;
  strength: number;
  activationCount: number;
  lastActivatedAt: number;
  originSession: string;
};

export const EMBEDDING_MODELS: Record<EmbeddingLanguage, CuratedModel[]> = {
  en: [
    { value: "all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2 — fast, lightweight" },
    { value: "all-mpnet-base-v2", label: "all-mpnet-base-v2 — higher quality" },
    { value: "multi-qa-MiniLM-L6-cos-v1", label: "multi-qa-MiniLM-L6-cos-v1 — QA optimised" }
  ],
  zh: [
    { value: "shibing624/text2vec-base-chinese", label: "text2vec-base-chinese — Chinese tuned" },
    { value: "DMetaSoul/sbert-chinese-general-v2", label: "sbert-chinese-general-v2 — general Chinese" },
    { value: "paraphrase-multilingual-MiniLM-L12-v2", label: "multilingual-MiniLM-L12-v2 — 50+ languages" }
  ],
  multi: [
    { value: "paraphrase-multilingual-MiniLM-L12-v2", label: "multilingual-MiniLM-L12-v2 — 50+ languages" },
    { value: "distiluse-base-multilingual-cased-v2", label: "distiluse-multilingual-v2 — 15 languages, light" },
    { value: "paraphrase-multilingual-mpnet-base-v2", label: "multilingual-mpnet-base-v2 — higher quality" },
    { value: "BAAI/bge-m3", label: "BGE-M3 — strong multilingual retrieval" }
  ]
};

export const LANGUAGE_OPTIONS: Array<{ value: EmbeddingLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
  { value: "multi", label: "Multi-Language" }
];

export const DEFAULT_MEMORY_DRAFT: MemoryDraft = {
  enabled: false,
  host: "127.0.0.1",
  port: "8788",
  recentTurns: "8",
  recallLimit: "20",
  recallMinScore: "0.6",
  timeoutMs: "1200",
  embeddingsModel: "all-MiniLM-L6-v2",
  genesisTurnsPerCall: "20",
  extractToolMessages: "drop",
  extractToolMaxCharsPerMsg: "1200",
  extractToolMaxTotalChars: "5000"
};
