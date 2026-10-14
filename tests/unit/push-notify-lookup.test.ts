import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns', () => ({ default: { lookup: h.lookup }, lookup: h.lookup }))
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }))
vi.mock('@/lib/db/drizzle', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { publicOnlyLookup } from '@/lib/push/notify'

function run(addresses: { address: string; family: number }[], all = false) {
  h.lookup.mockImplementation((_h: string, _o: unknown, cb: (e: null, a: unknown) => void) => cb(null, addresses))
  return new Promise<{ err: unknown; address: unknown; family?: number }>((resolve) =>
    publicOnlyLookup('fcm.googleapis.com', { all }, (err, address, family) => resolve({ err, address, family }))
  )
}

beforeEach(() => {
  h.lookup.mockReset()
  delete process.env.ALLOW_PRIVATE_OUTBOUND_URLS
})

describe('publicOnlyLookup', () => {
  it('passes a public address through', async () => {
    const r = await run([{ address: '142.250.1.1', family: 4 }])
    expect(r.err).toBeNull()
    expect(r.address).toBe('142.250.1.1')
  })
  it('returns the list when all is requested', async () => {
    const r = await run([{ address: '142.250.1.1', family: 4 }], true)
    expect(r.address).toEqual([{ address: '142.250.1.1', family: 4 }])
  })
  it('fails when any address is private', async () => {
    const r = await run([{ address: '142.250.1.1', family: 4 }, { address: '10.0.0.5', family: 4 }])
    expect(r.err).toBeTruthy()
  })
  it('fails for loopback and metadata addresses', async () => {
    expect((await run([{ address: '127.0.0.1', family: 4 }])).err).toBeTruthy()
    expect((await run([{ address: '169.254.169.254', family: 4 }])).err).toBeTruthy()
  })
})
