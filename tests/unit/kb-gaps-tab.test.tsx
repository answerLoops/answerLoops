// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/** The Gaps tab on the KB page: loading, locked, empty and populated states. */

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('@/components/billing/locked-feature', () => ({
  LockedFeature: ({ requiredPlan }: { requiredPlan: string }) => <div>locked:{requiredPlan}</div>,
}))
vi.stubGlobal('fetch', h.fetchMock)

const reply = (body: unknown, ok = true) =>
  h.fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response)

const TOTALS = {
  total: 3,
  needs_human: 1,
  low_confidence: 1,
  no_kb_article: 1,
  categories: [{ category: 'how_to', count: 3, avg_confidence: 0.4 }],
}
const gap = {
  id: 11,
  org_ticket_number: 5,
  summary: 'How do I reset my password?',
  category: 'how_to',
  confidence: 0.42,
  status: 'open',
  created_at: '2026-11-01T00:00:00Z',
  has_kb_article: false,
  gap_reason: 'low_confidence',
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GapsTab', () => {
  it('shows the upgrade prompt for a workspace without the feature', async () => {
    reply({ locked: true, requiredPlan: 'pro' })
    const { GapsTab } = await import('@/app/(dashboard)/kb/gaps-tab')
    render(<GapsTab />)
    expect(await screen.findByText('locked:pro')).toBeInTheDocument()
  })

  it('lists distinct questions with a link to the ticket and a + KB link carrying the ticket id', async () => {
    reply({ locked: false, totals: TOTALS, clusters: [{ lead: gap, count: 3 }] })
    const { GapsTab } = await import('@/app/(dashboard)/kb/gaps-tab')
    render(<GapsTab />)
    const link = await screen.findByRole('link', { name: 'How do I reset my password?' })
    expect(link).toHaveAttribute('href', '/tickets/5')
    expect(screen.getByRole('link', { name: '+ KB' })).toHaveAttribute('href', '/kb?sourceTicket=11')
    expect(screen.getByText('Asked 3 times')).toBeInTheDocument()
    expect(screen.getByText('Open gap tickets')).toBeInTheDocument()
  })

  it('says so when there are no gaps', async () => {
    reply({ locked: false, totals: { ...TOTALS, total: 0, categories: [] }, clusters: [] })
    const { GapsTab } = await import('@/app/(dashboard)/kb/gaps-tab')
    render(<GapsTab />)
    expect(await screen.findByText('No gaps found')).toBeInTheDocument()
  })

  it('shows an error when the load fails', async () => {
    reply({}, false)
    const { GapsTab } = await import('@/app/(dashboard)/kb/gaps-tab')
    render(<GapsTab />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load knowledge gaps/i)
  })
})
