// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityPanel } from '@/components/dashboard/activity-panel'
import type { Ticket } from '@/types'

afterEach(cleanup)

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 1,
    org_ticket_number: 5,
    content: 'raw content',
    ai_summary: 'Login fails',
    source_platform: 'slack',
    source_author_name: 'alice',
    last_activity_at: '2026-10-02T00:00:00.000Z',
    last_customer_reply_at: '2026-10-02T00:00:00.000Z',
    last_seen_at: null,
    ...overrides,
  } as Ticket
}

describe('ActivityPanel', () => {
  it.each([0, 1])('renders nothing for an empty list with count %i', (total) => {
    const { container } = render(<ActivityPanel tickets={[]} total={total} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a zero count even if the preview contains a ticket', () => {
    const { container } = render(<ActivityPanel tickets={[ticket({})]} total={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([[1, '1'], [5, '5'], [99, '99'], [100, '99+'], [200, '99+']])(
    'starts collapsed and exposes the exact total for %i tickets',
    (total, badge) => {
      render(<ActivityPanel tickets={[ticket({})]} total={total} />)
      const region = screen.getByRole('region', { name: 'Activity' })
      const toggle = within(region).getByRole('button', {
        name: `Activity, ${total} ${total === 1 ? 'ticket' : 'tickets'} with new customer replies`,
      })
      const preview = document.getElementById(toggle.getAttribute('aria-controls')!)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(preview).toHaveAttribute('hidden')
      expect(within(toggle).getByText(badge)).toBeVisible()
      expect(screen.getByText('Customers replied on these tickets. Opening one marks it seen.')).toBeVisible()
      expect(screen.getByRole('link', { name: `View all ${total} →` })).toHaveAttribute('href', '/tickets?newActivity=1&sort=activity')
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
    }
  )

  it('toggles the preview by click', async () => {
    const user = userEvent.setup()
    render(<ActivityPanel tickets={[ticket({})]} total={1} />)
    const toggle = screen.getByRole('button', { name: /Activity/ })
    const preview = document.getElementById(toggle.getAttribute('aria-controls')!)
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(preview).toContainElement(screen.getByRole('list'))
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(preview).toHaveAttribute('hidden')
  })

  it('supports Enter and Space from the keyboard', async () => {
    const user = userEvent.setup()
    render(<ActivityPanel tickets={[ticket({})]} total={1} />)
    const toggle = screen.getByRole('button', { name: /Activity/ })
    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the five supplied rows and a count note when there are six unseen tickets', async () => {
    const user = userEvent.setup()
    const tickets = [8, 7, 6, 5, 4].map((id) => ticket({
      id,
      org_ticket_number: id,
      last_customer_reply_at: `2026-10-0${id}T00:00:00.000Z`,
    }))
    render(<ActivityPanel tickets={tickets} total={6} />)
    const toggle = screen.getByRole('button', { name: /Activity/ })
    const preview = document.getElementById(toggle.getAttribute('aria-controls')!)
    const footer = screen.getByText('Showing the latest 5 of 6')
    expect(preview).toContainElement(footer)
    expect(preview).toHaveAttribute('hidden')
    await user.click(toggle)
    const rows = within(screen.getByRole('list')).getAllByRole('link')
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/tickets/8', '/tickets/7', '/tickets/6', '/tickets/5', '/tickets/4',
    ])
    expect(preview).not.toHaveAttribute('hidden')
    expect(screen.getByRole('link', { name: 'View all 6 →' })).toHaveAttribute('href', '/tickets?newActivity=1&sort=activity')
  })

  it.each([1, 5])('omits the footer for %i unseen tickets', async (total) => {
    const user = userEvent.setup()
    render(<ActivityPanel tickets={[ticket({})]} total={total} />)
    await user.click(screen.getByRole('button', { name: /Activity/ }))
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /View all/ })).toHaveLength(1)
  })

  it('renders a linked row per ticket with number, summary, author and platform', async () => {
    render(
      <ActivityPanel
        tickets={[ticket({}), ticket({ id: 2, org_ticket_number: 9, ai_summary: 'Billing question', source_platform: 'discord', source_author_name: 'bob' })]}
        total={2}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Activity/ }))
    const first = screen.getByText('Login fails').closest('a') as HTMLElement
    expect(first.getAttribute('href')).toBe('/tickets/5')
    expect(first.textContent).toContain('#5')
    expect(first.textContent).toContain('alice on Slack')
    const second = screen.getByText('Billing question').closest('a') as HTMLElement
    expect(second.getAttribute('href')).toBe('/tickets/9')
    expect(second.textContent).toContain('bob on Discord')
  })

  it('falls back to the content when there is no summary, and to "A customer" with no author', async () => {
    render(<ActivityPanel tickets={[ticket({ ai_summary: null, content: 'How do I reset my password?', source_author_name: null })]} total={1} />)
    await userEvent.click(screen.getByRole('button', { name: /Activity/ }))
    const row = screen.getByText(/How do I reset my password\?/).closest('a') as HTMLElement
    expect(row.textContent).toContain('A customer on Slack')
  })
})
