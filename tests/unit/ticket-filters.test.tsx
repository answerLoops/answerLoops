// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/tickets',
  useSearchParams: () => new URLSearchParams(nav.search),
}))

import { TicketFilters } from '@/components/tickets/ticket-filters'

beforeEach(() => {
  vi.clearAllMocks()
  nav.search = ''
})

const lastUrl = () => nav.replace.mock.calls.at(-1)![0] as string

describe('TicketFilters', () => {
  it('applies a choice straight away by updating the URL', async () => {
    render(<TicketFilters values={{}} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by priority' }), 'high')
    expect(lastUrl()).toBe('/tickets?priority=high')
    expect(nav.replace.mock.calls.at(-1)![1]).toEqual({ scroll: false })
  })

  it('keeps the status and any card filter already in the URL', async () => {
    nav.search = 'status=open&needsReview=1'
    render(<TicketFilters values={{}} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'bug')
    const params = new URLSearchParams(lastUrl().split('?')[1])
    expect(params.get('status')).toBe('open')
    expect(params.get('needsReview')).toBe('1')
    expect(params.get('category')).toBe('bug')
  })

  it('starts the list over by dropping the page cursor', async () => {
    nav.search = 'cursor=abc&priority=low'
    render(<TicketFilters values={{ priority: 'low' }} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort tickets' }), 'activity')
    const params = new URLSearchParams(lastUrl().split('?')[1])
    expect(params.has('cursor')).toBe(false)
    expect(params.get('sort')).toBe('activity')
    expect(params.get('priority')).toBe('low')
  })

  it('removes a filter when its All option is chosen', async () => {
    nav.search = 'platform=slack'
    render(<TicketFilters values={{ platform: 'slack' }} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by channel' }), '')
    expect(lastUrl()).toBe('/tickets')
  })

  it('toggles New activity', async () => {
    render(<TicketFilters values={{}} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'New activity' }))
    expect(lastUrl()).toBe('/tickets?newActivity=1')
  })

  it('shows the current values', () => {
    render(<TicketFilters values={{ priority: 'high', platform: 'github', newActivity: true }} />)
    expect((screen.getByRole('combobox', { name: 'Filter by priority' }) as HTMLSelectElement).value).toBe('high')
    expect((screen.getByRole('combobox', { name: 'Filter by channel' }) as HTMLSelectElement).value).toBe('github')
    expect(screen.getByRole('checkbox', { name: 'New activity' })).toBeChecked()
  })

  it('offers Clear filters only when one is active, and it keeps the status', () => {
    nav.search = 'status=open&priority=high&cursor=x'
    const { unmount } = render(<TicketFilters values={{ priority: 'high' }} />)
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/tickets?status=open')
    unmount()
    render(<TicketFilters values={{}} />)
    expect(screen.queryByRole('link', { name: 'Clear filters' })).toBeNull()
  })
})
