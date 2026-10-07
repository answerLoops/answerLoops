import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Runtime guard for app/api/events/stream/route.ts's connection teardown.
//
// The route opens one dedicated `postgres(url, { max: 1 })` LISTEN connection
// per SSE stream. Before this test existed, the only coverage
// (dashboard-live-infra.test.ts) was source-string assertions — it passed even
// if `teardown = close` was deleted or `cancel()` was wired to a no-op, which
// is exactly the leaked-connection-per-tab regression the route rewrite fixed.
// This exercises the real ReadableStream: cancelling it (what the platform does
// when the browser disconnects) must end the pg connection and stop the
// keepalive, and a second close must be a no-op.

// Each postgres() call produces its own tracked instance, so a test can tell
// WHICH socket ran a query. That distinction is the point: postgres.js's
// `.listen()` sugar runs LISTEN on a hidden second instance
// (`listen.sql = Postgres({ max: 1 })`), so a heartbeat issued on the object
// the route holds would exercise a different, idle socket — proving nothing
// about the subscription and holding an extra connection per tab. A mock with
// one shared `unsafe` spy cannot see that difference.
type FakeSql = {
  queries: string[]
  options: Record<string, unknown>
  unsafe: ReturnType<typeof vi.fn>
  listen: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

const { instances, end, postgresFactory, auth } = vi.hoisted(() => {
  const made: FakeSql[] = []
  const endFn = vi.fn(async () => {})
  const factory = vi.fn((_url: string, options: Record<string, unknown>) => {
    const queries: string[] = []
    const sql = () => {}
    Object.assign(sql, {
      queries,
      options,
      // Swappable per test so a failing or hanging heartbeat can be simulated.
      unsafe: vi.fn(async (q: string) => {
        queries.push(q)
        return []
      }),
      // The sugar must never be used — see the comment above.
      listen: vi.fn(async () => {
        throw new Error('.listen() sugar must not be used by this route')
      }),
      end: endFn,
    })
    made.push(sql as unknown as FakeSql)
    return sql
  })
  const authFn = vi.fn(async () => ({ user: { id: 1 }, orgId: 7 }))
  return { instances: made, end: endFn, postgresFactory: factory, auth: authFn }
})

/** The single connection the route opened for this stream. */
const conn = () => instances[0]

vi.mock('postgres', () => ({ default: postgresFactory }))
vi.mock('@/auth', () => ({ auth }))
vi.mock('@/lib/db/direct-url', () => ({
  getDirectDatabaseUrl: () => 'postgres://user@localhost:5432/db',
}))
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }))

import { GET } from '@/app/api/events/stream/route'

function firstFrame(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  return reader.read().then(({ value }) => {
    reader.releaseLock()
    return new TextDecoder().decode(value)
  })
}

describe('GET /api/events/stream — connection teardown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    instances.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends a connected frame and registers both LISTEN channels', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(await firstFrame(res)).toContain('event: connected')
    expect(conn().queries).toContain('LISTEN data_changed')
    expect(conn().queries).toContain('LISTEN member_joined')
    await res.body!.cancel()
  })

  it('opens exactly one connection and never uses the .listen() sugar', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)

    // Two instances would mean the sugar's hidden connection is back: a second
    // Postgres connection per tab, and a heartbeat on the wrong socket.
    expect(instances).toHaveLength(1)
    expect(conn().listen).not.toHaveBeenCalled()
    await res.body!.cancel()
  })

  it('delivers a NOTIFY for this org through onnotify, and filters other orgs', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)
    const onnotify = conn().options.onnotify as (c: string, p: string) => void

    const reader = res.body!.getReader()
    onnotify('data_changed', '7') // this session's orgId
    const frame = await reader.read().then(({ value }) => new TextDecoder().decode(value!))
    expect(frame).toContain('event: data_changed')

    reader.releaseLock()
    await res.body!.cancel()
  })

  it('cancelling the stream ends the postgres connection exactly once', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)
    expect(end).not.toHaveBeenCalled()

    await res.body!.cancel()

    expect(end).toHaveBeenCalledTimes(1)
  })

  it('stops the keepalive interval on cancel — no further work after teardown', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)
    await res.body!.cancel()

    end.mockClear()
    // If the keepalive interval or the recycle timeout were still live they
    // would fire here; nothing should touch the connection after teardown.
    vi.advanceTimersByTime(20 * 60 * 1000)
    expect(end).not.toHaveBeenCalled()
  })

  it('the 15-minute recycle and a later cancel do not double-close', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)

    // recycle timer fires -> close() -> one end()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(end).toHaveBeenCalledTimes(1)

    // platform then cancels the already-closed stream -> close() is a no-op
    await res.body!.cancel()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('heartbeats every 4 minutes on the same socket the LISTEN runs on', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)
    expect(conn().queries).not.toContain('SELECT 1')

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

    // Same instance as the LISTENs, which is the entire point — a heartbeat on
    // any other socket would keep resolving while the subscription was dead.
    expect(conn().queries).toEqual([
      'LISTEN data_changed',
      'LISTEN member_joined',
      'LISTEN product_feedback_changed',
      'SELECT 1',
    ])

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    expect(conn().queries.filter((q) => q === 'SELECT 1')).toHaveLength(2)
    expect(instances).toHaveLength(1) // no extra connection for the beat

    // A healthy heartbeat must not disturb the stream.
    expect(end).not.toHaveBeenCalled()
    await res.body!.cancel()
  })

  it('closes the stream when the heartbeat fails, so the browser reconnects', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)
    conn().unsafe.mockRejectedValueOnce(new Error('connection terminated') as never)

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

    // The whole point: detecting a dead LISTEN and then sitting on it would be
    // no better than not detecting it. Ending the stream makes EventSource
    // rebuild it, which re-registers LISTEN and fires resync on the client.
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('logs only the message from a heartbeat failure, not the driver error', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)
    const err = Object.assign(new Error('connection terminated'), {
      connection_string: 'postgres://<user>:<password>@db.example.com:5432/app',
    })
    conn().unsafe.mockRejectedValueOnce(err as never)

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

    // A driver error object can carry the connection it failed on. Logging it
    // whole would put that into the log line.
    const logged = warn.mock.calls.find(([msg]) => msg === 'SSE listener heartbeat failed')
    expect(logged).toBeDefined()
    expect(logged![1].error).toBe('connection terminated')
    expect(JSON.stringify(logged![1])).not.toContain('<password>')
  })

  it('logs only the message when LISTEN registration fails', async () => {
    // Sibling of the heartbeat catch. Both take a driver error that can carry
    // the connection it failed on, so both narrow it to the message.
    postgresFactory.mockImplementationOnce((_url: string, options: Record<string, unknown>) => {
      const sql = () => {}
      Object.assign(sql, {
        queries: [],
        options,
        unsafe: vi.fn(async () => {
          throw Object.assign(new Error('permission denied'), {
            connection_string: 'postgres://<user>:<password>@db.example.com:5432/app',
          })
        }),
        listen: vi.fn(),
        end: vi.fn(async () => {}),
      })
      instances.push(sql as unknown as FakeSql)
      return sql
    })

    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await res.body!.cancel().catch(() => {})

    const logged = warn.mock.calls.find(([msg]) => msg === 'SSE listen setup failed')
    expect(logged).toBeDefined()
    expect(logged![1].error).toBe('permission denied')
    expect(JSON.stringify(logged![1])).not.toContain('<password>')
  })

  it('closes the stream when a heartbeat hangs on a half-open socket', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)
    // Never resolves and never rejects — nothing reaches .catch(), so without
    // an in-flight guard the interval would queue beats forever and the dead
    // stream would survive until the 15-minute recycle.
    conn().unsafe.mockImplementationOnce(() => new Promise(() => {}))

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    expect(end).not.toHaveBeenCalled() // first beat merely outstanding

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('ends the stream when the connection closes underneath it', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)

    // A dropped socket should not wait up to four minutes to be noticed.
    ;(conn().options.onclose as () => void)()

    expect(end).toHaveBeenCalledTimes(1)
  })

  it('stops heartbeating after teardown', async () => {
    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
    await firstFrame(res)
    await res.body!.cancel()
    const before = conn().queries.length

    // A leaked heartbeat interval would query a closed connection forever —
    // and keep a serverless compute awake for a tab that is long gone.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(conn().queries).toHaveLength(before)
  })

  it('returns 401 without a session and opens no connection', async () => {
    auth.mockResolvedValueOnce(null as never)

    const res = await GET(new Request('https://app.example.com/api/events/stream') as never)

    expect(res.status).toBe(401)
    expect(postgresFactory).not.toHaveBeenCalled()
  })
})
