// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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
  it('renders nothing for an empty list', () => {
    const { container } = render(<ActivityPanel tickets={[]} total={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the Activity section with the total and a View all link', () => {
    render(<ActivityPanel tickets={[ticket({})]} total={14} />)
    const section = screen.getByRole('region', { name: /Activity/ })
    expect(within(section).getByText('14')).toBeTruthy()
    expect(screen.getByRole('link', { name: /View all/ }).getAttribute('href')).toBe('/tickets?newActivity=1&sort=activity')
  })

  it('renders a linked row per ticket with number, summary, author and platform', () => {
    render(
      <ActivityPanel
        tickets={[ticket({}), ticket({ id: 2, org_ticket_number: 9, ai_summary: 'Billing question', source_platform: 'discord', source_author_name: 'bob' })]}
        total={2}
      />
    )
    const first = screen.getByText('Login fails').closest('a') as HTMLElement
    expect(first.getAttribute('href')).toBe('/tickets/5')
    expect(first.textContent).toContain('#5')
    expect(first.textContent).toContain('alice on Slack')
    const second = screen.getByText('Billing question').closest('a') as HTMLElement
    expect(second.getAttribute('href')).toBe('/tickets/9')
    expect(second.textContent).toContain('bob on Discord')
  })

  it('falls back to the content when there is no summary, and to "A customer" with no author', () => {
    render(<ActivityPanel tickets={[ticket({ ai_summary: null, content: 'How do I reset my password?', source_author_name: null })]} total={1} />)
    const row = screen.getByText(/How do I reset my password\?/).closest('a') as HTMLElement
    expect(row.textContent).toContain('A customer on Slack')
  })
})
