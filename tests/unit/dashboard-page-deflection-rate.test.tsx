// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const h = vi.hoisted(() => ({
  statsCards: vi.fn(),
  getDeflectionStats: vi.fn(),
  getUnseenActivityTickets: vi.fn(async (): Promise<{ tickets: never[]; total: number; snapshot?: string }> => ({ tickets: [], total: 0 })),
  activityDisclosure: vi.fn(),
  user: { name: 'Sam Lee' } as { id?: string; name: string },
}))

vi.mock('@/auth', () => ({ auth: async () => ({ orgId: 7, user: h.user }) }))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketStats: async () => ({
    total: 100, open: 12, inProgress: 8, resolved: 30,
    slaBreaches: 2, pendingDrafts: 3, needsReview: 4, autoDeflected: 50,
  }),
  getSLABreachedTickets: async () => [],
  getTickets: async () => [],
  getUnseenActivityTickets: h.getUnseenActivityTickets,
}))
vi.mock('@/lib/db/queries/analytics', () => ({ getDeflectionStats: h.getDeflectionStats }))
vi.mock('@/components/dashboard/stats-cards', () => ({
  StatsCards: (props: Record<string, unknown>) => {
    h.statsCards(props)
    return null
  },
}))
vi.mock('@/components/dashboard/activity-disclosure', () => ({
  ActivityDisclosure: (props: Record<string, unknown>) => {
    h.activityDisclosure(props)
    return null
  },
}))
vi.mock('@/components/dashboard/sla-breach-list', () => ({ SLABreachList: () => null }))

import DashboardPage from '@/app/(dashboard)/dashboard/page'
import { verifyActivitySnapshot } from '@/lib/tickets/activity-snapshot'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('AUTH_SECRET', '<test-auth-secret>')
  h.user = { name: 'Sam Lee' }
})
afterEach(() => vi.unstubAllEnvs())

describe('DashboardPage deflection rate', () => {
  it('passes the analytics rate (deflected / answered), not auto-answered / total, to the stat cards', async () => {
    h.getDeflectionStats.mockResolvedValue({ deflected: 3, answered: 4 })
    render(await DashboardPage())

    expect(h.getDeflectionStats).toHaveBeenCalledWith(7)
    expect(h.statsCards).toHaveBeenCalledWith(expect.objectContaining({ deflectionRate: 75, autoDeflected: 50 }))
  })

  it('passes 0 when nothing has been answered yet', async () => {
    h.getDeflectionStats.mockResolvedValue({ deflected: 0, answered: 0 })
    render(await DashboardPage())

    expect(h.statsCards).toHaveBeenCalledWith(expect.objectContaining({ deflectionRate: 0 }))
  })
})

describe('DashboardPage activity preview', () => {
  it('requests only five unseen tickets for the current organization', async () => {
    h.getDeflectionStats.mockResolvedValue({ deflected: 0, answered: 0 })
    await DashboardPage()

    expect(h.getUnseenActivityTickets).toHaveBeenCalledExactlyOnceWith(7, 5)
  })
})

describe('DashboardPage activity proof', () => {
  const snapshot = '2026-10-02T00:00:00.123456Z|10:12:10'

  async function renderedProps() {
    h.getDeflectionStats.mockResolvedValue({ deflected: 0, answered: 0 })
    render(await DashboardPage())
    return h.activityDisclosure.mock.calls[0][0] as { snapshot?: string; proof?: string }
  }

  it('gives the panel a proof bound to the signed-in user and workspace', async () => {
    h.user = { id: '42', name: 'Sam Lee' }
    h.getUnseenActivityTickets.mockResolvedValue({ tickets: [], total: 3, snapshot })
    const props = await renderedProps()

    expect(props.snapshot).toBe(snapshot)
    expect(verifyActivitySnapshot(snapshot, props.proof!, 7, 42)).toBe(true)
    expect(verifyActivitySnapshot(snapshot, props.proof!, 7, 43)).toBe(false)
    expect(verifyActivitySnapshot(snapshot, props.proof!, 8, 42)).toBe(false)
  })

  it('gives the panel no proof when there is no signed-in user id', async () => {
    h.getUnseenActivityTickets.mockResolvedValue({ tickets: [], total: 3, snapshot })
    expect((await renderedProps()).proof).toBeUndefined()
  })

  it('gives the panel no proof when there is nothing to clear', async () => {
    h.user = { id: '42', name: 'Sam Lee' }
    h.getUnseenActivityTickets.mockResolvedValue({ tickets: [], total: 0 })
    expect((await renderedProps()).proof).toBeUndefined()
  })
})
