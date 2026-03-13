export type MemoryFact = {
  id: number;
  raw: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryStore = {
  nextId: number;
  facts: MemoryFact[];
};

export type ManagedMemoryDto = {
  id: string;
  raw: string;
  createdAt: number;
  updatedAt: number;
};
