import { beforeEach, describe, expect, it, vi } from 'vitest'

// Route-level check that the per-user stream cap is enforced and that closing
// a stream frees its slot.
const { postgresFactory, auth } = vi.hoisted(() => {
  const factory = vi.fn(() => {
    const sql = () => {}
    Object.assign(sql, { unsafe: vi.fn(async () => []), end: vi.fn(async () => {}) })
    return sql
  })
  return { postgresFactory: factory, auth: vi.fn(async () => ({ user: { id: 42 }, orgId: 903 })) }
})

vi.mock('postgres', () => ({ default: postgresFactory }))
vi.mock('@/auth', () => ({ auth }))
vi.mock('@/lib/db/direct-url', () => ({ getDirectDatabaseUrl: () => 'postgres://user@localhost:5432/db' }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { GET } from '@/app/api/events/stream/route'
import { MAX_STREAMS_PER_USER } from '@/lib/live-events-limits'

const open = () => GET(new Request('https://app.example.com/api/events/stream') as never)

describe('GET /api/events/stream — concurrent stream cap', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 429 past the per-user cap and admits a new stream after one closes', async () => {
    const streams: Response[] = []
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) {
      const res = await open()
      expect(res.status).toBe(200)
      streams.push(res)
    }

    const refused = await open()
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBeTruthy()

    await streams[0].body!.cancel()
    const admitted = await open()
    expect(admitted.status).toBe(200)

    await admitted.body!.cancel()
    for (const s of streams.slice(1)) await s.body!.cancel()
  })
})
