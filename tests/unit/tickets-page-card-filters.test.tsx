// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { getTickets, auth } = vi.hoisted(() => ({ getTickets: vi.fn(), auth: vi.fn() }))

vi.mock('@/lib/db/queries/tickets', () => ({
  getTickets,
  getTicketStatusCounts: async () => ({ open: 3, in_progress: 2, resolved: 1, closed: 0, duplicate: 0 }),
  encodeTicketCursor: () => 'next-cursor',
  decodeTicketCursor: () => null,
}))
vi.mock('@/auth', () => ({ auth }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/tickets',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: async () => true }))
vi.mock('@/components/billing/locked-csv-export-button', () => ({ LockedCsvExportButton: () => null }))
vi.mock('@/components/tickets/ticket-list', () => ({ TicketList: () => <div data-testid="ticket-list" /> }))

import TicketsPage from '@/app/(dashboard)/tickets/page'

async function renderPage(searchParams: Record<string, string>) {
  render(await TicketsPage({ searchParams: Promise.resolve(searchParams) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ orgId: 7 })
  getTickets.mockResolvedValue([])
})

describe('TicketsPage card filters', () => {
  it.each([
    ['autoDeflected', 'Auto-Answered'],
    ['needsReview', 'Needs Review'],
    ['pendingDraft', 'AI Drafts Pending'],
    ['slaBreached', 'SLA Breaches'],
  ])('passes ?%s=1 to the query and shows a "%s" indicator', async (param, label) => {
    await renderPage({ [param]: '1' })

    expect(getTickets).toHaveBeenCalledWith(expect.objectContaining({ [param]: true }), 7, 51, undefined, true)
    const indicator = screen.getByTestId('card-filter-indicator')
    expect(indicator).toHaveTextContent(`Filtered by${label}`)
  })

  it('only treats the value 1 as an active card filter', async () => {
    await renderPage({ needsReview: 'true', slaBreached: '0' })

    expect(getTickets).toHaveBeenCalledWith(
      expect.objectContaining({ needsReview: undefined, slaBreached: undefined }),
      7,
      51,
      undefined,
      true
    )
    expect(screen.queryByTestId('card-filter-indicator')).not.toBeInTheDocument()
  })

  it('shows no card-filter indicator when no card filter is active', async () => {
    await renderPage({ status: 'open' })

    expect(screen.queryByTestId('card-filter-indicator')).not.toBeInTheDocument()
  })

  it('clears only the card filters, keeping the dropdown filters', async () => {
    await renderPage({ needsReview: '1', status: 'open', priority: 'high' })

    expect(screen.getByRole('link', { name: 'Clear card filter' })).toHaveAttribute(
      'href',
      '/tickets?status=open&priority=high'
    )
  })

  it('clears to the bare tickets page when the card filter is the only filter', async () => {
    await renderPage({ autoDeflected: '1' })

    expect(screen.getByRole('link', { name: 'Clear card filter' })).toHaveAttribute('href', '/tickets')
  })

  it('carries card filters through the Load more link', async () => {
    getTickets.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ({ id: i + 1, created_at: '2026-01-01' })))
    await renderPage({ pendingDraft: '1' })

    const href = screen.getByRole('link', { name: 'Load more' }).getAttribute('href')!
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('pendingDraft')).toBe('1')
    expect(params.get('cursor')).toBe('next-cursor')
  })
})
