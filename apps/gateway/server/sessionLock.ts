/**
 * Ensure only one /api/chat request mutates a given session at a time.
 * Without this, concurrent requests can interleave events and build context from stale history.
 */
const sessionLockTails = new Map<string, Promise<void>>();

export async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLockTails.get(sessionId);
  // Never let a previous failure permanently block the queue.
  const prevSafe = prev ? prev.catch(() => {}) : Promise.resolve();

  let release: (() => void) | null = null;
  const next = new Promise<void>((resolve) => (release = resolve));

  const tail = prevSafe.then(() => next);
  sessionLockTails.set(sessionId, tail);

  await prevSafe;

  try {
    return await fn();
  } finally {
    try {
      release?.();
    } catch {
      // ignore
    }

    // Cleanup when the tail drains and nobody replaced it.
    tail
      .then(() => {
        if (sessionLockTails.get(sessionId) === tail) sessionLockTails.delete(sessionId);
      })
      .catch(() => {
        if (sessionLockTails.get(sessionId) === tail) sessionLockTails.delete(sessionId);
      });
  }
}
