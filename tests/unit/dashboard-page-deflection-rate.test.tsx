// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const h = vi.hoisted(() => ({
  statsCards: vi.fn(),
  getDeflectionStats: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: async () => ({ orgId: 7, user: { name: 'Sam Lee' } }) }))
vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketStats: async () => ({
    total: 100, open: 12, inProgress: 8, resolved: 30,
    slaBreaches: 2, pendingDrafts: 3, needsReview: 4, autoDeflected: 50,
  }),
  getSLABreachedTickets: async () => [],
  getTickets: async () => [],
  getUnseenActivityTickets: async () => [],
  countUnseenActivityTickets: async () => 0,
}))
vi.mock('@/lib/db/queries/analytics', () => ({ getDeflectionStats: h.getDeflectionStats }))
vi.mock('@/components/dashboard/stats-cards', () => ({
  StatsCards: (props: Record<string, unknown>) => {
    h.statsCards(props)
    return null
  },
}))
vi.mock('@/components/dashboard/sla-breach-list', () => ({ SLABreachList: () => null }))

import DashboardPage from '@/app/(dashboard)/dashboard/page'

beforeEach(() => vi.clearAllMocks())

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
