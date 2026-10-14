import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  requireOrgAccess: vi.fn(),
  returning: vi.fn(),
  onConflictDoUpdate: vi.fn(),
}))
vi.mock('node:dns/promises', () => ({ lookup: h.lookup }))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/request-id', () => ({ getRequestId: () => 'req' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: (args: unknown) => {
          h.onConflictDoUpdate(args)
          return { returning: h.returning }
        },
      }),
    }),
  }),
}))

import { assertValidPushEndpoint, isAllowedPushHost } from '@/lib/push/endpoint'
import { UnsafeUrlError } from '@/lib/http/safe-url'
import { POST } from '@/app/api/push/subscribe/route'

beforeEach(() => {
  vi.clearAllMocks()
  h.lookup.mockResolvedValue([{ address: '142.250.80.10', family: 4 }])
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 7 })
  h.returning.mockResolvedValue([{ id: 1 }])
})

describe('isAllowedPushHost', () => {
  it.each([
    'fcm.googleapis.com',
    'android.googleapis.com',
    'updates.push.services.mozilla.com',
    'web.push.apple.com',
    'wns2-par02p.notify.windows.com',
    'abc.push.apple.com',
  ])('allows %s', (host) => expect(isAllowedPushHost(host)).toBe(true))

  it.each([
    'evil.example.com',
    'notify.windows.com.evil.com',
    'fcm.googleapis.com.evil.com',
    'evilfcm.googleapis.com',
    'notify.windows.com',
    'push.apple.com',
    'localhost',
    '127.0.0.1',
  ])('rejects %s', (host) => expect(isAllowedPushHost(host)).toBe(false))
})

describe('assertValidPushEndpoint', () => {
  it('accepts a known push service over https', async () => {
    await expect(assertValidPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).resolves.toBeUndefined()
  })

  it('rejects http, unknown hosts, credentials and look-alike hosts', async () => {
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://evil.example.com/push',
      'https://169.254.169.254/',
      'https://fcm.googleapis.com@evil.example.com/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example.com/x',
      'not a url',
    ]) {
      await expect(assertValidPushEndpoint(bad)).rejects.toBeInstanceOf(UnsafeUrlError)
    }
  })

  it('rejects an allowlisted host whose DNS answer is private', async () => {
    h.lookup.mockResolvedValue([{ address: '10.0.0.9', family: 4 }])
    await expect(assertValidPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).rejects.toBeInstanceOf(UnsafeUrlError)
  })
})

function subscribeRequest(endpoint: string) {
  return new Request('http://localhost/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint, keys: { p256dh: 'k', auth: 'a' } }),
  })
}

describe('POST /api/push/subscribe', () => {
  it('stores a valid subscription for the caller org', async () => {
    const res = await POST(subscribeRequest('https://fcm.googleapis.com/fcm/send/abc'))
    expect(res.status).toBe(200)
  })

  it('rejects an endpoint that is not a known push service', async () => {
    const res = await POST(subscribeRequest('https://evil.example.com/push'))
    expect(res.status).toBe(400)
    expect(h.onConflictDoUpdate).not.toHaveBeenCalled()
  })

  it('never reassigns the org on conflict: the update does not set orgId and is scoped to the same org', async () => {
    await POST(subscribeRequest('https://fcm.googleapis.com/fcm/send/abc'))
    const args = h.onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown>; setWhere: unknown }
    expect(args.set).not.toHaveProperty('orgId')
    expect(args.setWhere).toBeDefined()
  })

  it('returns 409 when the endpoint already belongs to another org (no row updated)', async () => {
    h.returning.mockResolvedValue([])
    const res = await POST(subscribeRequest('https://fcm.googleapis.com/fcm/send/abc'))
    expect(res.status).toBe(409)
  })

  it('requires an authenticated org', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const res = await POST(subscribeRequest('https://fcm.googleapis.com/fcm/send/abc'))
    expect(res.status).toBe(401)
  })
})
