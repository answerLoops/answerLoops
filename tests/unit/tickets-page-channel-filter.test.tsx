// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { Ticket } from '@/types'
import { isSourcePlatform, platformLabel } from '@/lib/tickets/platform-label'

const { getTickets, auth } = vi.hoisted(() => ({ getTickets: vi.fn(), auth: vi.fn() }))

vi.mock('@/lib/db/queries/tickets', () => ({
  getTickets,
  getTicketStatusCounts: async () => ({ open: 3, in_progress: 2, resolved: 1, closed: 0, duplicate: 0 }),
  encodeTicketCursor: () => 'cursor-123',
  decodeTicketCursor: (cursor?: string) => (cursor === 'prev-cursor' ? { createdAt: '2026-10-02T00:00:00.000Z', id: 5 } : null),
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

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await TicketsPage({ searchParams: Promise.resolve(searchParams) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ orgId: 7 })
  getTickets.mockResolvedValue([])
})

describe('TicketsPage channel filter', () => {
  it('renders the channel filter dropdown with "All channels" and every supported platform', async () => {
    await renderPage()

    const select = screen.getByRole('combobox', { name: 'Filter by channel' }) as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('')

    const options = within(select).getAllByRole('option')
    const optionTexts = options.map((o) => o.textContent)
    const optionValues = options.map((o) => (o as HTMLOptionElement).value)

    expect(optionTexts).toEqual([
      'All channels',
      'Discord',
      'Slack',
      'Google Chat',
      'Telegram',
      'Email',
      'GitHub',
      'Discourse',
      'Circle',
      'Agent',
    ])
    expect(optionValues).toEqual([
      '',
      'discord',
      'slack',
      'google_chat',
      'telegram',
      'email',
      'github',
      'discourse',
      'circle',
      'mcp',
    ])
  })

  it('passes a valid platform to getTickets and sets select defaultValue', async () => {
    await renderPage({ platform: 'github' })

    expect(getTickets).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'github' }),
      7,
      51,
      undefined,
      true
    )

    const select = screen.getByRole('combobox', { name: 'Filter by channel' }) as HTMLSelectElement
    expect(select.value).toBe('github')
  })

  it('safely ignores an unknown platform parameter', async () => {
    await renderPage({ platform: 'unknown_service' })

    expect(getTickets).toHaveBeenCalledWith(
      expect.objectContaining({ platform: undefined }),
      7,
      51,
      undefined,
      true
    )

    const select = screen.getByRole('combobox', { name: 'Filter by channel' }) as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('preserves the platform filter in the Load more pagination link', async () => {
    // Generate 51 tickets to trigger the hasMore and nextCursor condition (PAGE_SIZE = 50)
    const fakeTickets = Array.from({ length: 51 }, (_, i) => ({
      id: i + 1,
      org_ticket_number: i + 1,
      created_at: '2026-10-02T00:00:00.000Z',
      last_activity_at: '2026-10-02T00:00:00.000Z',
      source_platform: 'slack',
      status: 'open',
    })) as Ticket[]
    getTickets.mockResolvedValue(fakeTickets)

    await renderPage({ platform: 'slack', status: 'open' })

    const loadMore = screen.getByRole('link', { name: 'Load more' })
    const href = loadMore.getAttribute('href')
    expect(href).toContain('platform=slack')
    expect(href).toContain('status=open')
    expect(href).toContain('cursor=cursor-123')
  })

  it('preserves the platform filter when clearing a dashboard card filter', async () => {
    await renderPage({ platform: 'email', needsReview: '1', status: 'open' })

    const clearLink = screen.getByRole('link', { name: 'Clear card filter' })
    const href = clearLink.getAttribute('href')
    expect(href).toContain('platform=email')
    expect(href).toContain('status=open')
    expect(href).not.toContain('needsReview')
  })

  it('combines platform with newActivity and sort parameters', async () => {
    await renderPage({ platform: 'github', newActivity: '1', sort: 'activity' })

    expect(getTickets).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'github',
        newActivity: true,
        sort: 'activity',
      }),
      7,
      51,
      undefined,
      true
    )
  })

  it('validates source platforms and handles label fallbacks correctly', () => {
    expect(isSourcePlatform('github')).toBe(true)
    expect(isSourcePlatform('unknown_platform')).toBe(false)
    expect(isSourcePlatform(null)).toBe(false)
    expect(isSourcePlatform(123)).toBe(false)

    expect(platformLabel('github')).toBe('GitHub')
    expect(platformLabel('mcp')).toBe('Agent')
    expect(platformLabel('discord')).toBe('Discord')
    expect(platformLabel(null)).toBe('Discord')
    expect(platformLabel(undefined)).toBe('Discord')
    expect(platformLabel('custom_platform')).toBe('custom_platform')
  })
})
