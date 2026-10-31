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

// Scoped by widget token, visitor and the per-tab session id, so two tabs open
// as the same visitor each get their own entry and can't clear or consume one
// another's result. None of the three can contain ':' (see
// lib/widget/request-validation.ts), so the joined key is unambiguous.
function keyFor(widgetToken: string, visitorId: string, sessionId: string): string {
  return `${widgetToken}:${visitorId}:${sessionId}`
}

export function setLeadSignal(
  widgetToken: string,
  visitorId: string,
  sessionId: string,
  signal: WidgetLeadSignal
): void {
  const now = Date.now()
  sweepExpired(now)
  signals.set(keyFor(widgetToken, visitorId, sessionId), { signal, expiresAt: now + SIGNAL_TTL_MS })
}

/**
 * Deletes the entry it reads (the client only ever checks once per turn), so
 * a second poll — or a later turn that never reaches the point where it
 * would overwrite this entry itself — can't be answered with a stale result
 * left over from an earlier turn. Call clearLeadSignal at the start of a run
 * for that same reason: see its doc comment.
 */
export function getLeadSignal(widgetToken: string, visitorId: string, sessionId: string): WidgetLeadSignal {
  const now = Date.now()
  sweepExpired(now)
  const key = keyFor(widgetToken, visitorId, sessionId)
  const entry = signals.get(key)
  if (!entry || entry.expiresAt < now) return 'none'
  signals.delete(key)
  return entry.signal
}

/**
 * Clears any leftover signal from an earlier turn. Call this as soon as the
 * request's token, visitor and session have been validated — before any
 * check that can reject the run — and before it can fail or produce its own result — without it,
 * a run that errors out before reaching the point where it would set its own
 * signal (quota exceeded, no AI provider configured, a thrown error) leaves
 * the previous turn's entry in place, and the client's next poll would show
 * an on-failure prompt that describes a turn that never actually happened.
 */
export function clearLeadSignal(widgetToken: string, visitorId: string, sessionId: string): void {
  signals.delete(keyFor(widgetToken, visitorId, sessionId))
}
