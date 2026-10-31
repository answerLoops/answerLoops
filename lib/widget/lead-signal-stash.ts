import type { WidgetLeadSignal } from '@/lib/widget/lead-capture'

/**
 * Short-lived, process-local record of "how did this widget turn go" — written
 * by app/api/widget/chat/route.ts and read by app/api/widget/lead-signal/route.ts,
 * which the client polls right after a turn finishes. Process-local is an
 * accepted trade-off here, same as `pendingRuns` next door in the chat route:
 * this is an ephemeral UI hint, not state that needs to survive a restart or
 * a horizontally-scaled deployment. Worst case on a miss, the on-failure
 * prompt doesn't appear.
 *
 * One entry per *turn* (widget token + visitor + the turn id the client sends
 * with that message), not per visitor. That is what lets reads be repeatable:
 * a poll whose response was lost can simply ask again, and a turn that was
 * rejected or failed before it recorded anything has no entry to be mistaken
 * for a different turn's result. Nothing needs clearing — an old turn's entry
 * is never addressable by a new turn's id, and expires on its own.
 */
interface Entry {
  signal: WidgetLeadSignal
  question: string
  expiresAt: number
}

const signals = new Map<string, Entry>()

// Long enough for the client's post-turn lookup, including its short retries,
// to land after the stream closes.
const SIGNAL_TTL_MS = 60_000

// Hard ceiling so a flood of turns can't grow the map without bound between
// sweeps; the oldest entries (Map iterates in insertion order) go first.
const MAX_ENTRIES = 5_000

const SWEEP_INTERVAL_MS = 30_000
let nextSweepAt = Date.now() + SWEEP_INTERVAL_MS

function sweepExpired(now: number): void {
  if (now < nextSweepAt) return
  nextSweepAt = now + SWEEP_INTERVAL_MS
  for (const [key, entry] of signals) {
    if (entry.expiresAt < now) signals.delete(key)
  }
}

// Keyed by widgetToken rather than orgId: the lead-signal route only ever has
// the token off the wire, and resolving it to an org means a DB lookup it has
// no other reason to make. A token is specific to one org, so this loses no
// isolation. None of the three parts can contain ':' (see
// lib/widget/request-validation.ts).
function keyFor(widgetToken: string, visitorId: string, turnId: string): string {
  return `${widgetToken}:${visitorId}:${turnId}`
}

export function setLeadSignal(
  widgetToken: string,
  visitorId: string,
  turnId: string,
  signal: WidgetLeadSignal,
  question: string
): void {
  const now = Date.now()
  sweepExpired(now)
  while (signals.size >= MAX_ENTRIES) {
    const oldest = signals.keys().next().value
    if (oldest === undefined) break
    signals.delete(oldest)
  }
  signals.set(keyFor(widgetToken, visitorId, turnId), { signal, question, expiresAt: now + SIGNAL_TTL_MS })
}

/** Does not consume the entry: asking twice gets the same answer until it expires. */
export function getLeadSignal(
  widgetToken: string,
  visitorId: string,
  turnId: string
): { signal: WidgetLeadSignal; question: string } {
  const now = Date.now()
  sweepExpired(now)
  const entry = signals.get(keyFor(widgetToken, visitorId, turnId))
  if (!entry || entry.expiresAt < now) return { signal: 'none', question: '' }
  return { signal: entry.signal, question: entry.question }
}
