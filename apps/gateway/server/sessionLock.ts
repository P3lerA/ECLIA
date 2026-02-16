/**
 * Ensure only one /api/chat request mutates a given session at a time.
 * Without this, concurrent requests can interleave events and build context from stale history.
 */
const sessionLockTails = new Map<string, Promise<void>>();

export async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLockTails.get(sessionId);
  // Never let a previous failure permanently block the queue.
  const prevSafe = prev ? prev.catch(() => {}) : Promise.resolve();

  // The Promise executor runs synchronously, so `release` will be assigned
  // before we ever reach `finally`. Initialize to a no-op to avoid TS watch-mode
  // narrowing oddities (and keep the `finally` block simple).
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = () => resolve();
  });

  const tail = prevSafe.then(() => next);
  sessionLockTails.set(sessionId, tail);

  await prevSafe;

  try {
    return await fn();
  } finally {
    // Release the lock for the next queued task.
    release();

    // Cleanup when the tail drains and nobody replaced it.
    void tail.finally(() => {
      if (sessionLockTails.get(sessionId) === tail) sessionLockTails.delete(sessionId);
    });
  }
}
