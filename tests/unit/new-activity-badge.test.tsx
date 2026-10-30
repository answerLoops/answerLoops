// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NewActivityBadge } from '@/components/tickets/new-activity-badge'
import { TicketList } from '@/components/tickets/ticket-list'
import type { Ticket } from '@/types'

afterEach(cleanup)

const REPLY = '2026-10-02T12:00:00.000Z'

describe('NewActivityBadge', () => {
  it('shows when the customer replied and the team has never opened the ticket', () => {
    render(<NewActivityBadge ticket={{ last_customer_reply_at: REPLY, last_seen_at: null }} />)
    expect(screen.getByText('New activity')).toBeTruthy()
  })

  it('shows when the ticket was last seen before the reply', () => {
    render(<NewActivityBadge ticket={{ last_customer_reply_at: REPLY, last_seen_at: '2026-10-02T11:00:00.000Z' }} />)
    expect(screen.getByText('New activity')).toBeTruthy()
  })

  it('is hidden when the customer never replied', () => {
    const { container } = render(<NewActivityBadge ticket={{ last_customer_reply_at: null, last_seen_at: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is hidden once the team has seen the reply', () => {
    const { container } = render(<NewActivityBadge ticket={{ last_customer_reply_at: REPLY, last_seen_at: '2026-10-02T13:00:00.000Z' }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

let nextId = 1
function ticket(overrides: Partial<Ticket>): Ticket {
  const id = nextId++
  return {
    id,
    org_ticket_number: id,
    content: `question ${id}`,
    category: 'general_question',
    priority: 'medium',
    status: 'open',
    ai_summary: `summary ${id}`,
    ai_draft_status: null,
    source_platform: 'slack',
    source_message_id: null,
    source_channel_id: null,
    source_thread_id: null,
    source_author_name: 'alice',
    created_at: '2026-10-01T00:00:00.000Z',
    sla_response_deadline: null,
    sla_resolve_deadline: null,
    last_activity_at: '2026-10-01T00:00:00.000Z',
    last_customer_reply_at: null,
    last_seen_at: null,
    ...overrides,
  } as Ticket
}

describe('TicketList new activity badge', () => {
  it('flags only the rows with unseen customer activity', () => {
    render(
      <TicketList
        tickets={[
          ticket({ ai_summary: 'unseen row', last_customer_reply_at: REPLY, last_seen_at: null }),
          ticket({ ai_summary: 'seen row', last_customer_reply_at: REPLY, last_seen_at: '2026-10-03T00:00:00.000Z' }),
          ticket({ ai_summary: 'quiet row' }),
        ]}
      />
    )
    const row = (s: string) => screen.getByText(s).closest('tr') as HTMLElement
    expect(row('unseen row').textContent).toContain('New activity')
    expect(row('seen row').textContent).not.toContain('New activity')
    expect(row('quiet row').textContent).not.toContain('New activity')
    expect(screen.getAllByText('New activity')).toHaveLength(1)
  })
})
