// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getTicketByOrgTicketNumber: vi.fn(),
  markTicketSeen: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/notifications', () => ({ markAllNotificationsRead: h.markAllNotificationsRead }))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketByOrgTicketNumber: h.getTicketByOrgTicketNumber,
  markTicketSeen: h.markTicketSeen,
}))
vi.mock('next/cache', () => ({ refresh: h.refresh }))

import { markAllNotificationsReadAction, markTicketSeenAction } from '@/lib/actions/notifications'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 3 })
})

describe('markAllNotificationsReadAction', () => {
  it('clears the caller org and refreshes', async () => {
    expect(await markAllNotificationsReadAction()).toEqual({ ok: true })
    expect(h.markAllNotificationsRead).toHaveBeenCalledWith(3)
    expect(h.refresh).toHaveBeenCalled()
  })

  it('does nothing when unauthenticated', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(await markAllNotificationsReadAction()).toEqual({ ok: false })
    expect(h.markAllNotificationsRead).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})

describe('markTicketSeenAction', () => {
  it('resolves the number inside the caller org and marks that ticket seen in that org', async () => {
    h.getTicketByOrgTicketNumber.mockResolvedValue({ id: 42 })
    h.markTicketSeen.mockResolvedValue(true)
    expect(await markTicketSeenAction(17)).toEqual({ ok: true })
    expect(h.getTicketByOrgTicketNumber).toHaveBeenCalledWith(17, 3)
    expect(h.markTicketSeen).toHaveBeenCalledWith(42, 3)
    expect(h.refresh).toHaveBeenCalled()
  })

  it('returns ok:false when unauthenticated and changes nothing', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect(await markTicketSeenAction(17)).toEqual({ ok: false })
    expect(h.getTicketByOrgTicketNumber).not.toHaveBeenCalled()
    expect(h.markTicketSeen).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, Number.NaN, Infinity])('rejects %s without touching anything', async (n) => {
    expect(await markTicketSeenAction(n)).toEqual({ ok: false })
    expect(h.getTicketByOrgTicketNumber).not.toHaveBeenCalled()
    expect(h.markTicketSeen).not.toHaveBeenCalled()
  })

  it('returns ok:false when the number does not exist in the caller org', async () => {
    h.getTicketByOrgTicketNumber.mockResolvedValue(null)
    expect(await markTicketSeenAction(17)).toEqual({ ok: false })
    expect(h.markTicketSeen).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('does not refresh when the ticket row was not found by the update', async () => {
    h.getTicketByOrgTicketNumber.mockResolvedValue({ id: 42 })
    h.markTicketSeen.mockResolvedValue(false)
    expect(await markTicketSeenAction(17)).toEqual({ ok: false })
    expect(h.refresh).not.toHaveBeenCalled()
  })
})
