// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  getTickets: vi.fn(),
  getTicketStatusCounts: vi.fn(),
  auth: vi.fn(),
  canExport: { value: true },
}))

vi.mock('@/lib/db/queries/tickets', () => ({
  getTickets: h.getTickets,
  getTicketStatusCounts: h.getTicketStatusCounts,
  encodeTicketCursor: () => 'cursor-1',
  decodeTicketCursor: () => null,
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: async () => h.canExport.value }))
vi.mock('@/components/billing/locked-csv-export-button', () => ({ LockedCsvExportButton: () => <button>locked-export</button> }))
vi.mock('@/components/tickets/ticket-list', () => ({ TicketList: () => <div data-testid="ticket-list" /> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/tickets',
  useSearchParams: () => new URLSearchParams(),
}))

import TicketsPage from '@/app/(dashboard)/tickets/page'

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await TicketsPage({ searchParams: Promise.resolve(searchParams) }))
}

const nav = () => screen.getByRole('navigation', { name: 'Ticket status' })

beforeEach(() => {
  vi.clearAllMocks()
  h.canExport.value = true
  h.auth.mockResolvedValue({ orgId: 7 })
  h.getTickets.mockResolvedValue([])
  h.getTicketStatusCounts.mockResolvedValue({ open: 3, in_progress: 2, resolved: 1, closed: 4, duplicate: 0 })
})

describe('Tickets status tabs', () => {
  it('reads the counts for the caller\'s own org', async () => {
    await renderPage()
    expect(h.getTicketStatusCounts).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('shows each status with its count, and All as the total', async () => {
    await renderPage()
    const links = within(nav()).getAllByRole('link').map((l) => l.textContent)
    expect(links).toEqual(['All10', 'Open3', 'In progress2', 'Resolved1', 'Closed4'])
  })

  it('links each tab to its status and marks the current one', async () => {
    await renderPage({ status: 'in_progress' })
    const tab = (name: RegExp) => within(nav()).getByRole('link', { name })
    expect(tab(/^Open/)).toHaveAttribute('href', '/tickets?status=open')
    expect(tab(/^In progress/)).toHaveAttribute('aria-current', 'page')
    expect(tab(/^Open/)).not.toHaveAttribute('aria-current')
    expect(tab(/^All/)).toHaveAttribute('href', '/tickets')
  })

  it('marks All as current when no status is chosen', async () => {
    await renderPage()
    expect(within(nav()).getByRole('link', { name: /^All/ })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps the other filters when switching tab, and drops the page cursor', async () => {
    await renderPage({ priority: 'high', platform: 'slack', status: 'open' })
    const href = within(nav()).getByRole('link', { name: /^Resolved/ }).getAttribute('href')!
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('status')).toBe('resolved')
    expect(params.get('priority')).toBe('high')
    expect(params.get('platform')).toBe('slack')
    expect(params.has('cursor')).toBe(false)
  })

  it('keeps a dashboard card filter when switching tab', async () => {
    await renderPage({ needsReview: '1' })
    const href = within(nav()).getByRole('link', { name: /^Open/ }).getAttribute('href')!
    expect(new URLSearchParams(href.split('?')[1]).get('needsReview')).toBe('1')
  })

  it('only shows a Duplicate tab when there are duplicates, or one is being viewed', async () => {
    await renderPage()
    expect(within(nav()).queryByRole('link', { name: /^Duplicate/ })).toBeNull()
  })

  it('shows the Duplicate tab when duplicates exist', async () => {
    h.getTicketStatusCounts.mockResolvedValue({ open: 0, in_progress: 0, resolved: 0, closed: 0, duplicate: 2 })
    await renderPage()
    expect(within(nav()).getByRole('link', { name: /^Duplicate/ })).toHaveAttribute('href', '/tickets?status=duplicate')
  })

  it('keeps the Duplicate tab visible while viewing duplicates, even with none left', async () => {
    await renderPage({ status: 'duplicate' })
    expect(within(nav()).getByRole('link', { name: /^Duplicate/ })).toHaveAttribute('aria-current', 'page')
  })
})

describe('Tickets header actions', () => {
  it('puts Export CSV in the page header', async () => {
    await renderPage()
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/export/tickets')
  })

  it('shows the locked export button without the csv_export feature', async () => {
    h.canExport.value = false
    await renderPage()
    expect(screen.getByText('locked-export')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Export CSV' })).toBeNull()
  })

  it('has no Filter button, since filters apply as you change them', async () => {
    await renderPage()
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
  })
})
