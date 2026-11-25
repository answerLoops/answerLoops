// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  getDeflectionTrend: vi.fn(),
  getDocGaps: vi.fn(),
  features: { csat_scoring: true, knowledge_gap_dashboard: true } as Record<string, boolean>,
  accuracy: [] as unknown[],
}))

vi.mock('@/auth', () => ({ auth: async () => ({ orgId: 7 }) }))
vi.mock('@/lib/db/queries/analytics', () => ({
  getDeflectionStats: async () => ({ totalTickets: 12, answered: 10, deflected: 8 }),
  getDeflectionTrend: h.getDeflectionTrend,
  getCategoryBreakdown: async () => [{ category: 'how_to', count: 3 }],
  getDocGaps: h.getDocGaps,
  getSLAStats: async () => ({ responseMet: 0, responseBreached: 0, resolveBreached: 0, avgFirstResponseMinutes: null }),
}))
vi.mock('@/lib/db/queries/feedback', () => ({ getDeflectionAccuracyByCategory: async () => h.accuracy }))
vi.mock('@/lib/db/queries/csat', () => ({ getCsatStats: async () => ({ totalRatings: 0, avgRating: null, breakdown: [] }) }))
vi.mock('@/lib/db/queries/orgs', () => ({ getOrgROIConfig: async () => ({ minutesPerTicket: 10, staffHourlyRate: 50 }) }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: async (_o: number, f: string) => h.features[f] ?? false }))

import AnalyticsPage from '@/app/(dashboard)/analytics/page'

const gap = (id: number) => ({ id, org_ticket_number: id, summary: `Gap ${id}` })

async function renderPage(range?: string) {
  render(await AnalyticsPage({ searchParams: Promise.resolve(range ? { range } : {}) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.features = { csat_scoring: true, knowledge_gap_dashboard: true }
  h.accuracy = []
  h.getDeflectionTrend.mockResolvedValue([])
  h.getDocGaps.mockResolvedValue([])
})

describe('Analytics page range', () => {
  it('shows the last 30 days by default', async () => {
    await renderPage()
    expect(h.getDeflectionTrend).toHaveBeenCalledExactlyOnceWith(30, 7)
  })

  it.each([['7', 7], ['90', 90]])('?range=%s asks for that many days', async (param, days) => {
    await renderPage(param)
    expect(h.getDeflectionTrend).toHaveBeenCalledExactlyOnceWith(days, 7)
  })

  it('ignores an unsupported range', async () => {
    await renderPage('9999')
    expect(h.getDeflectionTrend).toHaveBeenCalledExactlyOnceWith(30, 7)
  })
})

describe('Analytics documentation gaps', () => {
  it('previews five and links to the Knowledge gaps tab', async () => {
    h.getDocGaps.mockResolvedValue([1, 2, 3, 4, 5, 6, 7].map(gap))
    await renderPage()
    expect(screen.getByRole('link', { name: 'Gap 5' })).toHaveAttribute('href', '/tickets/5')
    expect(screen.queryByRole('link', { name: 'Gap 6' })).toBeNull()
    expect(screen.getByText('and 2 more')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all in Knowledge gaps →' })).toHaveAttribute('href', '/kb?tab=gaps')
  })

  it('without the Knowledge gaps feature, shows no link into it and says what unlocks it', async () => {
    h.features = { csat_scoring: true, knowledge_gap_dashboard: false }
    h.getDocGaps.mockResolvedValue([1, 2, 3, 4, 5, 6].map(gap))
    await renderPage()
    expect(screen.queryByRole('link', { name: /See all in Knowledge gaps/ })).toBeNull()
    expect(screen.getByText(/unlocks the full Knowledge gaps view/)).toBeInTheDocument()
  })

  it('says so when there are none', async () => {
    await renderPage()
    expect(screen.getByText(/No gaps/)).toBeInTheDocument()
  })
})
