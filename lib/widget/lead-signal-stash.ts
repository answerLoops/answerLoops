import type { WidgetLeadSignal } from '@/lib/widget/lead-capture'

/**
 * Short-lived, process-local record of "how did this visitor's last widget
 * turn go" — written by app/api/widget/chat/route.ts and read by
 * app/api/widget/lead-signal/route.ts, which the client polls right after a
 * turn finishes. Process-local is an accepted trade-off here, same as
 * `pendingRuns` next door in the chat route: this is an ephemeral UI hint,
 * not state that needs to survive a restart or a horizontally-scaled
 * deployment. Worst case on a miss, the on-failure prompt doesn't appear.
 */
const signals = new Map<string, { signal: WidgetLeadSignal; expiresAt: number }>()

// Long enough for the client's immediate post-turn lookup (one fetch, no
// retry loop) to land comfortably after the stream closes; short enough that
// a stale entry from an old turn can never answer a later one.
const SIGNAL_TTL_MS = 30_000

const SWEEP_INTERVAL_MS = 60_000
let nextSweepAt = Date.now() + SWEEP_INTERVAL_MS

function sweepExpired(now: number): void {
  if (now < nextSweepAt) return
  nextSweepAt = now + SWEEP_INTERVAL_MS
  for (const [key, entry] of signals) {
    if (entry.expiresAt < now) signals.delete(key)
  }
}

function keyFor(orgId: number, visitorId: string): string {
  return `${orgId}:${visitorId}`
}

export function setLeadSignal(orgId: number, visitorId: string, signal: WidgetLeadSignal): void {
  const now = Date.now()
  sweepExpired(now)
  signals.set(keyFor(orgId, visitorId), { signal, expiresAt: now + SIGNAL_TTL_MS })
}

/**
 * Deletes the entry it reads (the client only ever checks once per turn), so
 * a second poll — or a later turn that never reaches the point where it
 * would overwrite this entry itself — can't be answered with a stale result
 * left over from an earlier turn. Call clearLeadSignal at the start of a run
 * for that same reason: see its doc comment.
 */
export function getLeadSignal(orgId: number, visitorId: string): WidgetLeadSignal {
  const key = keyFor(orgId, visitorId)
  const entry = signals.get(key)
  if (!entry || entry.expiresAt < Date.now()) return 'none'
  signals.delete(key)
  return entry.signal
}

/**
 * Clears any leftover signal from an earlier turn. Call this once a new run
 * is accepted and before it can fail or produce its own result — without it,
 * a run that errors out before reaching the point where it would set its own
 * signal (quota exceeded, no AI provider configured, a thrown error) leaves
 * the previous turn's entry in place, and the client's next poll would show
 * an on-failure prompt that describes a turn that never actually happened.
 */
export function clearLeadSignal(orgId: number, visitorId: string): void {
  signals.delete(keyFor(orgId, visitorId))
}
