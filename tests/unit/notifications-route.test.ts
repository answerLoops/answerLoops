// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  getRecentNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
}))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/notifications', () => ({
  getRecentNotifications: h.getRecentNotifications,
  getUnreadCount: h.getUnreadCount,
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { GET } from '@/app/api/notifications/route'

const req = () => new Request('http://localhost/api/notifications')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/notifications', () => {
  it('returns 401 and reads nothing when access fails', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(h.getRecentNotifications).not.toHaveBeenCalled()
    expect(h.getUnreadCount).not.toHaveBeenCalled()
  })

  it('returns the caller org notifications and unread count, uncached', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 3 })
    h.getRecentNotifications.mockResolvedValue([{ id: 1, message: 'm' }])
    h.getUnreadCount.mockResolvedValue(2)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ notifications: [{ id: 1, message: 'm' }], unread: 2 })
    expect(h.getRecentNotifications).toHaveBeenCalledWith(3)
    expect(h.getUnreadCount).toHaveBeenCalledWith(3)
  })

  it('returns 500 when a query throws', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 3 })
    h.getRecentNotifications.mockRejectedValue(new Error('db down'))
    h.getUnreadCount.mockResolvedValue(0)
    expect((await GET(req())).status).toBe(500)
  })
})
