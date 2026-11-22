// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getTicketByOrgTicketNumber: vi.fn(),
  markTicketSeen: vi.fn(),
  markAllTicketsSeen: vi.fn(),
  refresh: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/db/queries/notifications', () => ({ markAllNotificationsRead: h.markAllNotificationsRead }))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketByOrgTicketNumber: h.getTicketByOrgTicketNumber,
  markTicketSeen: h.markTicketSeen,
  markAllTicketsSeen: h.markAllTicketsSeen,
}))
vi.mock('next/cache', () => ({ refresh: h.refresh, revalidatePath: h.revalidatePath }))

import { markAllNotificationsReadAction, markAllTicketsSeenAction, markTicketSeenAction } from '@/lib/actions/notifications'
import { signActivitySnapshot } from '@/lib/tickets/activity-snapshot'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 3, userId: 5, role: 'member' })
})

afterEach(() => vi.unstubAllEnvs())

describe('markAllTicketsSeenAction', () => {
  const snapshot = '2026-10-02T00:00:00.123456Z|10:11:10'

  beforeEach(() => vi.stubEnv('AUTH_SECRET', '<test-auth-secret>'))

  it.each([0, 1, 198])('returns the database count %i and refreshes both surfaces', async (count) => {
    h.markAllTicketsSeen.mockResolvedValue(count)
    expect(await markAllTicketsSeenAction(snapshot, signActivitySnapshot(snapshot, 3, 5))).toEqual({ ok: true, count })
    expect(h.requireOrgAccess).toHaveBeenCalledWith()
    expect(h.markAllTicketsSeen).toHaveBeenCalledWith(3, snapshot)
    expect(h.refresh).toHaveBeenCalledOnce()
    expect(h.revalidatePath).toHaveBeenCalledWith('/tickets')
  })

  it('rejects a stale membership, a changed snapshot, and proofs from other workspaces or users', async () => {
    const proof = signActivitySnapshot(snapshot, 3, 5)
    h.requireOrgAccess.mockResolvedValueOnce({ ok: false, error: 'Unauthorized' })
    expect(await markAllTicketsSeenAction(snapshot, proof)).toEqual({ ok: false })
    expect(await markAllTicketsSeenAction('2026-10-02T00:01:00.123456Z|10:11:10', proof)).toEqual({ ok: false })
    expect(await markAllTicketsSeenAction(snapshot.replace('10:11:10', '10:11:'), proof)).toEqual({ ok: false })
    expect(await markAllTicketsSeenAction(snapshot, signActivitySnapshot(snapshot, 4, 5))).toEqual({ ok: false })
    expect(await markAllTicketsSeenAction(snapshot, signActivitySnapshot(snapshot, 3, 6))).toEqual({ ok: false })
    expect(h.markAllTicketsSeen).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('leaves the routes alone if the transaction fails', async () => {
    h.markAllTicketsSeen.mockRejectedValue(new Error('Transaction failed'))
    await expect(markAllTicketsSeenAction(snapshot, signActivitySnapshot(snapshot, 3, 5))).rejects.toThrow('Transaction failed')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.revalidatePath).not.toHaveBeenCalled()
  })
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
