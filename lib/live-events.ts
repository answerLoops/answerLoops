'use client'

/**
 * One shared Server-Sent Events connection per browser tab.
 *
 * `/api/events/stream` opens a dedicated, non-pooled Postgres LISTEN
 * connection for the life of each stream — a NOTIFY lands on whichever
 * backend Postgres picks, so a pooled connection can miss it. That makes an
 * open stream expensive on a connection-capped database, and before this
 * module a Settings tab held two of them: one from `DashboardLive` (mounted
 * on every dashboard route by the layout) and one from the Settings page's
 * own live team-member list, both LISTENing on an overlapping channel set.
 *
 * Every client island now subscribes here instead of constructing its own
 * `EventSource`. The stream is opened on the first subscriber and closed
 * after the last one goes away, so a tab holds exactly one LISTEN connection
 * no matter how many islands are watching.
 *
 * Resilience lives here too, since it is a property of the connection rather
 * than of any one subscriber. An SSE / LISTEN connection can die silently
 * (proxy idle-drop, database failover, laptop sleep) with no error surfacing
 * to either end, so:
 *  - Staleness watchdog: if no event or keepalive `ping` arrives within
 *    STALE_MS, the stream is torn down and rebuilt, which gives the server a
 *    fresh LISTEN.
 *  - The stream is closed entirely while the tab is hidden and reopened on
 *    return, so a backgrounded tab holds no database connection.
 *
 * All of those mean a subscriber can miss notifications that fired while the
 * connection was down, so every reconnect emits a synthetic `resync` event and
 * subscribers holding their own state re-fetch rather than waiting for the next
 * change. There are three reconnect paths and all three emit it: the watchdog
 * rebuild, the return from a hidden tab, and the browser's own transparent
 * `EventSource` reconnect — which we detect from a second `connected`, since
 * the server sends exactly one per successful LISTEN registration. That last
 * path is how the server's 15-minute stream recycle is covered: it never
 * reaches our code, and keepalives resume immediately, so the watchdog does not
 * trip.
 *
 * A cold open emits nothing, because nothing has been missed yet: the first
 * open after `start()`, including a tab that was hidden at mount and opened its
 * first stream on becoming visible.
 */

const STREAM_URL = '/api/events/stream'

/** No event or keepalive for this long means the connection is presumed dead. */
const STALE_MS = 70_000

/** How often the staleness check runs. */
const WATCHDOG_MS = 15_000

/** Server events that carry meaning, plus the synthetic reopen signal. */
export type LiveEvent = 'data_changed' | 'member_joined' | 'feedback_changed' | 'resync'

/** Server events that only reset the staleness clock. `connected` is handled
 *  separately in openStream(), since a repeat of it also signals a reconnect. */
const KEEPALIVE_EVENTS = ['ping', 'cycle'] as const

const DATA_EVENTS = ['data_changed', 'member_joined', 'feedback_changed'] as const

type Subscriber = {
  events: ReadonlySet<LiveEvent>
  handler: (event: LiveEvent) => void
}

const subscribers = new Set<Subscriber>()

let source: EventSource | null = null
let watchdog: ReturnType<typeof setInterval> | undefined
let lastBeat = 0

/** Has any stream been opened since `start()`? Distinguishes a cold open, where
 *  nothing can have been missed, from a reopen, where something can. */
let everOpened = false

/** Has the current EventSource already seen a `connected`? A second one means
 *  the browser reconnected underneath us and the server re-registered LISTEN. */
let listenRegistered = false

function emit(event: LiveEvent) {
  // Copy first: a handler may unsubscribe itself while we are iterating.
  for (const sub of [...subscribers]) {
    if (!sub.events.has(event)) continue
    try {
      sub.handler(event)
    } catch (err) {
      // One subscriber must not silence the others. Without this, a throw in
      // the first handler on a `resync` would skip every later one — leaving
      // exactly the stale client state this module exists to refresh.
      // Not lib/logger: in production that writes to process.stdout, which
      // does not exist in the browser bundle, so the handler meant to contain
      // a throw would throw itself.
      console.error('[live-events] subscriber threw on', event, err)
    }
  }
}

function beat() {
  lastBeat = Date.now()
}

function openStream() {
  if (source || subscribers.size === 0) return
  beat()
  everOpened = true
  const es = new EventSource(STREAM_URL)
  source = es

  es.addEventListener('connected', () => {
    beat()
    // The server sends `connected` once, after registering both LISTENs. A
    // second one on this same EventSource means the browser reconnected on its
    // own (the server's 15-minute recycle, a proxy blip) against a fresh
    // LISTEN, and anything notified in that gap reached nobody. Keepalives
    // resume straight away, so the watchdog never sees this.
    if (listenRegistered) emit('resync')
    listenRegistered = true
  })
  for (const event of KEEPALIVE_EVENTS) es.addEventListener(event, beat)
  for (const event of DATA_EVENTS) {
    es.addEventListener(event, () => {
      beat()
      emit(event)
    })
  }
  // EventSource retries on its own after a transient network error. A
  // silently-dead upstream LISTEN never reaches here — that is what the
  // watchdog is for.
  es.onerror = () => {}
}

function closeStream() {
  source?.close()
  source = null
  // The next stream is a new EventSource, so its first `connected` is a first
  // registration, not evidence of a reconnect.
  listenRegistered = false
}

/** Rebuild the connection, then tell subscribers they may have missed events. */
function reopenStream() {
  // A tab hidden at mount opens its first stream here rather than in start().
  // Nothing has been missed in that case, so it must not fire resync and make
  // every subscriber refetch what it just fetched on mount.
  const mayHaveMissedEvents = everOpened
  closeStream()
  openStream()
  if (mayHaveMissedEvents) emit('resync')
}

function checkStaleness() {
  if (document.hidden || !source) return
  if (Date.now() - lastBeat > STALE_MS) reopenStream()
}

function onVisibilityChange() {
  if (document.hidden) closeStream()
  // Only when the stream is actually gone. A visibilitychange that does not
  // change visibility would otherwise tear down a healthy EventSource, rebuild
  // the Postgres LISTEN behind it, and force a pointless refetch on everyone.
  else if (!source) reopenStream()
}

function start() {
  watchdog = setInterval(checkStaleness, WATCHDOG_MS)
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (!document.hidden) openStream()
}

function stop() {
  clearInterval(watchdog)
  watchdog = undefined
  document.removeEventListener('visibilitychange', onVisibilityChange)
  closeStream()
  // The next subscriber begins a new session: its first open is cold again.
  everOpened = false
}

/**
 * Watch `events` on the tab's shared stream. The returned function
 * unsubscribes and must be called on unmount — the connection is closed once
 * the last subscriber leaves.
 *
 * Subscribe to `resync` as well as the events you care about if you hold
 * state that a missed notification would leave stale.
 */
export function subscribeLiveEvents(
  events: readonly LiveEvent[],
  handler: (event: LiveEvent) => void
): () => void {
  const subscriber: Subscriber = { events: new Set(events), handler }
  subscribers.add(subscriber)
  if (subscribers.size === 1) start()

  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) stop()
  }
}
