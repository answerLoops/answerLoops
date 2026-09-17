import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { rateLimitBuckets } from '@/lib/db/schema'

// Process-local fixed-window rate limiter. Good enough for a single-instance
// deployment; swap for a shared store (Redis) if we scale horizontally.
const buckets = new Map<string, { count: number; reset: number }>()

// Expired buckets are swept, not just overwritten on re-use: some keys derive
// from request-supplied values, so the Map stays bounded by the sweep rather
// than by the size of the key space.
const SWEEP_INTERVAL_MS = 60_000
let nextSweepAt = Date.now() + SWEEP_INTERVAL_MS

function sweepExpired(now: number): void {
  if (now < nextSweepAt) return
  nextSweepAt = now + SWEEP_INTERVAL_MS
  for (const [key, bucket] of buckets) {
    if (bucket.reset < now) buckets.delete(key)
  }
}

export interface RateLimitResult {
  ok: boolean
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number
  /** Hits recorded in the current window so far, including this one. */
  count: number
  /** When the current window resets, regardless of `ok`. */
  resetAt: Date
}

/**
 * Allow up to `max` hits per `windowMs` for a given `key`.
 * Returns `{ ok: false, retryAfterMs }` once the bucket is exhausted.
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  sweepExpired(now)
  const bucket = buckets.get(key)

  if (!bucket || bucket.reset < now) {
    const reset = now + windowMs
    buckets.set(key, { count: 1, reset })
    return { ok: true, retryAfterMs: 0, count: 1, resetAt: new Date(reset) }
  }

  if (bucket.count >= max) {
    return { ok: false, retryAfterMs: bucket.reset - now, count: bucket.count, resetAt: new Date(bucket.reset) }
  }

  bucket.count++
  return { ok: true, retryAfterMs: 0, count: bucket.count, resetAt: new Date(bucket.reset) }
}

// Cleanup of long-stale rows — e.g. one-off/scanner IPs that will never come
// back to re-touch their bucket. No cron job: this mirrors the in-process
// sweeper without needing a scheduler.
//
// Time-based rather than probabilistic. A 1%-per-call chance leaves growth
// unbounded in the tail: some keys embed request-derived input, so a burst of
// distinct keys can insert far more rows than the sweep probability clears,
// and the interval between sweeps is unbounded at low traffic. An interval
// guarantees at most one sweep per window and at least one per window of
// traffic — the same contract the Map-backed sweeper had.
const CLEANUP_INTERVAL_MS = 60_000
let nextCleanupAt = 0

/**
 * Postgres-backed equivalent of `rateLimit`, shared across every instance —
 * fixes #169, where the in-process Map limiter's effective ceiling becomes
 * `max * instance count` on any horizontally-scaled or serverless deploy and
 * resets on every restart.
 *
 * Implemented as a single atomic upsert (INSERT .. ON CONFLICT DO UPDATE)
 * rather than a separate check-then-increment round trip, so two concurrent
 * requests for the same key can't both read the same pre-increment count and
 * both be admitted — the same class of race as #168.
 */
export async function rateLimitShared(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  const db = getDb()
  const now = new Date()
  const newReset = new Date(now.getTime() + windowMs)

  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key, count: 1, resetAt: newReset })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: {
        count: sql`CASE WHEN ${rateLimitBuckets.resetAt} < now() THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
        resetAt: sql`CASE WHEN ${rateLimitBuckets.resetAt} < now() THEN ${newReset.toISOString()}::timestamptz ELSE ${rateLimitBuckets.resetAt} END`,
      },
    })
    .returning({ count: rateLimitBuckets.count, resetAt: rateLimitBuckets.resetAt })

  // Fire-and-forget: don't let cleanup latency add to this call's response
  // time, and don't let a cleanup failure fail the rate-limit check itself.
  // nextCleanupAt is advanced before the query runs so concurrent calls in the
  // same window don't each fire their own DELETE.
  if (now.getTime() >= nextCleanupAt) {
    nextCleanupAt = now.getTime() + CLEANUP_INTERVAL_MS
    db.execute(sql`DELETE FROM rate_limit_buckets WHERE reset_at < now() - interval '1 hour'`).catch(
      () => {}
    )
  }

  if (row.count > max) {
    return { ok: false, retryAfterMs: Math.max(0, row.resetAt.getTime() - now.getTime()), count: row.count, resetAt: row.resetAt }
  }

  return { ok: true, retryAfterMs: 0, count: row.count, resetAt: row.resetAt }
}
