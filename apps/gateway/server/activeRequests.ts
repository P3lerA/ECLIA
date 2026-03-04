export type RequestPhase = "recalling" | "generating" | "tool_executing";

export type ActiveRequest = {
  sessionId: string;
  phase: RequestPhase;
  startedAt: number;
  updatedAt: number;
};

const active = new Map<string, ActiveRequest>();

export function setActiveRequest(sessionId: string, phase: RequestPhase): void {
  const existing = active.get(sessionId);
  if (existing) {
    existing.phase = phase;
    existing.updatedAt = Date.now();
  } else {
    active.set(sessionId, {
      sessionId,
      phase,
      startedAt: Date.now(),
      updatedAt: Date.now()
    });
  }
}

export function clearActiveRequest(sessionId: string): void {
  active.delete(sessionId);
}

export function getActiveRequest(sessionId: string): ActiveRequest | null {
  return active.get(sessionId) ?? null;
}
