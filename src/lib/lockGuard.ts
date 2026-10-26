/**
 * Auto-lock fires when the app is hidden. Some hidden moments are ours — the file picker, the
 * camera, the fingerprint prompt — and locking then would throw away what you were doing.
 * Callers suspend auto-lock for those moments and resume when done.
 */
const holds = new Map<number, number>()
let next = 1

/** Pause auto-lock (for at most `maxMs`). Returns a function that resumes it. */
export function suspendAutoLock(maxMs = 120_000): () => void {
  const id = next++
  holds.set(id, Date.now() + maxMs)
  return () => {
    holds.delete(id)
  }
}

export function isAutoLockSuspended(): boolean {
  const now = Date.now()
  for (const [id, until] of holds) {
    if (until < now) holds.delete(id)
  }
  return holds.size > 0
}
