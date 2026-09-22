// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MockEventSource, defineVisibility } from './mock-event-source'
import { render, act } from '@testing-library/react'
import { DashboardLive } from '@/components/dashboard/dashboard-live'

/**
 * DashboardLive is the client island that replaced `<AutoRefresh intervalMs={5000}>`.
 * It renders nothing and lives entirely inside one useEffect. The behaviour that
 * is easy to break silently and that these tests pin:
 *
 *  - It opens exactly one EventSource to `/api/events/stream`, and only while the
 *    tab is visible.
 *  - `data_changed` / `member_joined` collapse into a single debounced
 *    `router.refresh()` (DEBOUNCE_MS = 400).
 *  - A staleness watchdog (every 15s) tears down and rebuilds the stream when no
 *    beat has arrived for > 70s; any keepalive (`ping`, `connected`, `cycle`)
 *    resets that clock.
 *  - A backstop `router.refresh()` after BACKSTOP_MS of silence, re-armed by every
 *    refresh and suppressed (but kept armed) while hidden.
 *  - `visibilitychange` closes the stream when hidden and reopens + refreshes on
 *    return.
 *  - Unmount clears both intervals, the debounce timeout, the visibility listener
 *    and closes the stream — nothing fires afterwards.
 *
 * happy-dom has no EventSource, so a MockEventSource is installed on the global
 * for the duration of each test and instances are tracked to assert reopen.
 */

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ refresh: mockRefresh })),
}))




function fireVisibilityChange(hidden: boolean) {
  defineVisibility(hidden)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function emit(type: string, source = MockEventSource.last) {
  act(() => {
    source.emit(type)
  })
}

const BACKSTOP = 10 * 60 * 1000

// Advance time on a stream the server is keeping alive: it sends `ping` every
// 25s, so the staleness watchdog never trips in production and must not trip
// here either, or its reconnect resyncs would be counted as backstop
// refreshes. A ping is deliberately NOT proof the LISTEN works, so it must not
// re-arm the backstop — that distinction is what these tests pin.
function advanceAlive(ms: number) {
  for (let left = ms; left > 0; left -= 25_000) {
    advance(Math.min(25_000, left))
    emit('ping')
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  MockEventSource.reset()
  defineVisibility(false)
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DashboardLive — stream lifecycle', () => {
  it('opens exactly one EventSource to /api/events/stream on mount while visible', () => {
    render(<DashboardLive />)

    expect(MockEventSource.openCount).toBe(1)
    expect(MockEventSource.last.url).toBe('/api/events/stream')
    expect(MockEventSource.last.closed).toBe(false)
  })

  it('does not open a stream on mount when the tab is already hidden', () => {
    defineVisibility(true)
    render(<DashboardLive />)

    expect(MockEventSource.openCount).toBe(0)
  })
})

describe('DashboardLive — debounced refresh on data events', () => {
  it('a single data_changed triggers exactly one router.refresh() after 400ms', () => {
    render(<DashboardLive />)

    emit('data_changed')
    expect(mockRefresh).not.toHaveBeenCalled()

    advance(399)
    expect(mockRefresh).not.toHaveBeenCalled()

    advance(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('multiple data_changed within the debounce window collapse into one refresh', () => {
    render(<DashboardLive />)

    emit('data_changed')
    advance(100)
    emit('data_changed')
    advance(100)
    emit('data_changed')
    advance(399)
    expect(mockRefresh).not.toHaveBeenCalled()

    advance(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('member_joined also triggers a debounced refresh', () => {
    render(<DashboardLive />)

    emit('member_joined')
    advance(400)

    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('DashboardLive — staleness watchdog', () => {
  it('closes and reopens the stream after > 70s with no beat while visible', () => {
    render(<DashboardLive />)
    const first = MockEventSource.last

    advance(75_000)

    expect(first.closed).toBe(true)
    expect(MockEventSource.openCount).toBe(2)
    expect(MockEventSource.last).not.toBe(first)
    expect(MockEventSource.last.closed).toBe(false)
  })

  it('refreshes immediately when the watchdog rebuilds a stale stream', () => {
    render(<DashboardLive />)

    advance(60_000)
    advance(15_000) // watchdog tick at 75s: > 70s with no beat

    // The reopen emits `resync`: the connection was down, so a change may have
    // been missed. That refresh is immediate, not debounced.
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('a ping within the window resets lastBeat and prevents the reopen', () => {
    render(<DashboardLive />)
    const first = MockEventSource.last

    advance(60_000)
    emit('ping', first)
    advance(15_000)

    expect(first.closed).toBe(false)
    expect(MockEventSource.openCount).toBe(1)
  })
})

describe('DashboardLive — idle backstop', () => {
  it('fires only after BACKSTOP_MS of silence, not on a fixed interval', () => {
    render(<DashboardLive />)

    advanceAlive(BACKSTOP - 30_000)
    // The old fixed 60s interval would have refreshed nine times by now.
    expect(mockRefresh).not.toHaveBeenCalled()

    advanceAlive(60_000)
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    // And it re-arms itself: a LISTEN that stays dead must keep being caught,
    // not caught once and then abandoned.
    advanceAlive(BACKSTOP)
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })

  it('a data_changed re-arms it, so an active dashboard never runs it', () => {
    render(<DashboardLive />)

    // An arriving event is itself proof the LISTEN is alive, which is exactly
    // what the backstop exists to check — so it should reset the clock.
    for (let i = 0; i < 5; i++) {
      advanceAlive(BACKSTOP - 60_000)
      emit('data_changed')
      advance(400) // debounce
    }

    // Five refreshes from the events themselves, none from the backstop.
    expect(mockRefresh).toHaveBeenCalledTimes(5)
  })

  it('a keepalive ping alone does not re-arm it', () => {
    render(<DashboardLive />)

    // A ping travels over HTTP and never touches Postgres, so it says nothing
    // about whether the LISTEN behind it is alive. Treating it as proof would
    // make the backstop blind to the exact failure it guards against.
    advanceAlive(BACKSTOP + 30_000)

    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not fire while the tab is hidden, and stays armed for its return', () => {
    render(<DashboardLive />)

    fireVisibilityChange(true)
    mockRefresh.mockClear()

    advance(BACKSTOP * 3)
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

describe('DashboardLive — visibilitychange', () => {
  it('closes the stream when the tab is hidden', () => {
    render(<DashboardLive />)
    const first = MockEventSource.last

    fireVisibilityChange(true)

    expect(first.closed).toBe(true)
    expect(MockEventSource.openCount).toBe(1)
  })

  it('reopens the stream and refreshes immediately when the tab becomes visible again', () => {
    render(<DashboardLive />)
    fireVisibilityChange(true)
    mockRefresh.mockClear()

    fireVisibilityChange(false)

    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(MockEventSource.openCount).toBe(2)
    expect(MockEventSource.last.closed).toBe(false)
  })
})

describe('DashboardLive — backstop/debounce overlap', () => {
  it('refreshes once for an event arriving just before the backstop deadline', () => {
    render(<DashboardLive />)

    // Land a data_changed inside the final debounce window. If the switch were
    // only re-armed when a refresh fires, the backstop would go off at the
    // deadline and the debounced refresh would follow 400ms later — two
    // refreshes of the same route for one event. Re-arming on receipt closes
    // that window.
    advanceAlive(BACKSTOP - 200)
    emit('data_changed')

    advance(200) // the old deadline passes
    advance(400) // the debounce settles

    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('DashboardLive — resync supersedes a pending debounce', () => {
  it('refreshes once when resync lands on top of an armed data_changed', () => {
    render(<DashboardLive />)

    emit('data_changed') // arms the 400ms debounce
    advance(100)

    fireVisibilityChange(true)
    fireVisibilityChange(false) // reopen -> resync -> immediate refresh
    advance(1_000)

    // The debounced refresh must be cancelled, not left to fire behind the
    // resync's — the two would refresh the same route twice for one event.
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('DashboardLive — unmount cleanup', () => {
  it('closes the stream and stops all timers so nothing fires after unmount', () => {
    const { unmount } = render(<DashboardLive />)
    const first = MockEventSource.last

    unmount()

    expect(first.closed).toBe(true)

    advance(300_000)
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(MockEventSource.openCount).toBe(1)
  })

  it('clears a pending debounce timeout on unmount (no refresh for an in-flight data_changed)', () => {
    const { unmount } = render(<DashboardLive />)

    emit('data_changed')
    unmount()
    advance(1_000)

    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

describe('DashboardLive — the backstop across a visibility round trip', () => {
  it('re-arms from the resync on return to visible, not from mount', () => {
    render(<DashboardLive />)

    advanceAlive(300_000) // halfway to the mount deadline at 600s
    expect(mockRefresh).not.toHaveBeenCalled()

    fireVisibilityChange(true)
    fireVisibilityChange(false) // reopen -> resync -> immediate refresh

    expect(mockRefresh).toHaveBeenCalledTimes(1)

    // That refresh is proof the LISTEN behind the fresh stream is alive, so the
    // switch must now measure from it. The arm left over from mount would
    // otherwise fire at 600s and refresh a page that just refreshed 300s ago.
    advanceAlive(330_000) // t = 630s: past the mount deadline
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    advanceAlive(270_000) // t = 900s: BACKSTOP_MS after the resync
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })

  it('stays armed through a deadline that passes while hidden, and fires on the new schedule', () => {
    // Mounting hidden is what makes this observable. On the usual path back
    // from hidden, `lib/live-events` emits a resync that re-arms the switch on
    // its own, so a backstop that quietly died while hidden would look healthy.
    // A tab hidden at mount opens its first stream cold — nothing can have been
    // missed, so no resync — leaving only the hidden re-arm to keep it alive.
    defineVisibility(true)
    render(<DashboardLive />)

    // Deadline at 600s passes while hidden: no refresh (a hidden tab holds no
    // stream and has nothing to have missed), but the switch re-arms to 1200s.
    advance(660_000)
    expect(mockRefresh).not.toHaveBeenCalled()

    fireVisibilityChange(false)
    expect(MockEventSource.openCount).toBe(1) // first stream, opened cold
    expect(mockRefresh).not.toHaveBeenCalled() // cold open: nothing missed

    advanceAlive(539_999) // t = 1_199_999
    expect(mockRefresh).not.toHaveBeenCalled()

    advance(1) // t = 1_200_000: one BACKSTOP_MS after the hidden re-arm
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('DashboardLive — member_joined drives the backstop like data_changed', () => {
  it('debounces, then re-arms the switch from its refresh', () => {
    render(<DashboardLive />)

    advanceAlive(BACKSTOP - 60_000) // t = 540s, 60s short of the deadline
    emit('member_joined')

    // Debounced like a data_changed, not immediate like a resync: a new member
    // is an ordinary row change, and a burst of them must collapse.
    advance(399)
    expect(mockRefresh).not.toHaveBeenCalled()

    advance(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    // An arriving member_joined is the same proof of a live LISTEN that a
    // data_changed is, so it must push the deadline out by a full BACKSTOP_MS.
    advanceAlive(90_000) // t = 630.4s: past the deadline it replaced
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    advanceAlive(BACKSTOP - 90_000) // t = 1140.4s: BACKSTOP_MS after the refresh
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })
})

describe('DashboardLive — unmount with the backstop armed', () => {
  it('never fires after unmount, however long the page has been gone', () => {
    const { unmount } = render(<DashboardLive />)

    emit('data_changed')
    advance(400) // refresh, which re-arms the switch
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    mockRefresh.mockClear()

    advanceAlive(300_000)
    unmount()

    // A leaked backstop would call router.refresh() on a router from an
    // unmounted tree, and re-arm itself every BACKSTOP_MS forever after.
    advance(BACKSTOP * 3)
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(MockEventSource.openCount).toBe(1)
  })
})
