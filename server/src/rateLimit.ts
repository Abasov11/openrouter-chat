/** Fixed-window per-key counter. In-memory: fine for one process, resets on restart. */
export function createRateLimiter(limit: number, windowMs: number, now = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return function check(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
    const t = now()
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k)
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs }
      hits.set(key, entry)
    }
    if (++entry.count > limit) return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - t) / 1000) }
    return { ok: true }
  }
}
