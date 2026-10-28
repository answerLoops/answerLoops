// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { TicketThread } from '@/components/tickets/ticket-thread'
import { buildTicketThread } from '@/lib/tickets/thread'
import type { TicketReply, TicketReplyRole } from '@/types'

afterEach(cleanup)

let nextId = 1
function reply(role: TicketReplyRole, author: string, content: string, createdAt: string, id = nextId++): TicketReply {
  return { id, ticket_id: 1, staff_name: author, content, discord_msg_id: null, author_role: role, source_message_id: null, created_at: createdAt }
}

describe('buildTicketThread', () => {
  it('orders messages oldest first whatever order they are stored in', () => {
    const thread = buildTicketThread([
      reply('staff', 'Sam', 'third', '2026-05-01T10:30:00.000Z'),
      reply('customer', 'alice', 'first', '2026-05-01T09:00:00.000Z'),
      reply('context', 'maint', 'second', '2026-05-01T10:00:00.000Z'),
    ])
    expect(thread.map((e) => e.content)).toEqual(['first', 'second', 'third'])
  })

  it('keeps arrival order for messages written in the same instant', () => {
    const t = '2026-05-01T09:00:00.000Z'
    const thread = buildTicketThread([reply('customer', 'a', 'b', t, 8), reply('customer', 'a', 'a', t, 7)])
    expect(thread.map((e) => e.content)).toEqual(['a', 'b'])
  })

  it('carries role and author through', () => {
    const [entry] = buildTicketThread([reply('context', 'maint', 'hi', '2026-05-01T09:00:00.000Z')])
    expect(entry).toMatchObject({ role: 'context', author: 'maint', content: 'hi' })
  })

  it('does not mutate its input', () => {
    const input = [reply('staff', 'b', '2', '2026-05-02T00:00:00.000Z'), reply('staff', 'a', '1', '2026-05-01T00:00:00.000Z')]
    const before = input.map((r) => r.id)
    buildTicketThread(input)
    expect(input.map((r) => r.id)).toEqual(before)
  })
})

describe('TicketThread', () => {
  it('renders nothing for a ticket with no further messages', () => {
    const { container } = render(<TicketThread replies={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows every message in order, each labeled with its author and role', () => {
    render(
      <TicketThread
        replies={[
          reply('customer', 'alice', 'Still broken after the update', '2026-05-01T09:00:00.000Z'),
          reply('context', 'maint', 'Looking into this now', '2026-05-01T09:30:00.000Z'),
          reply('staff', 'Sam', 'A fix is on the way', '2026-05-01T10:00:00.000Z'),
        ]}
      />
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items.map((li) => li.getAttribute('data-role'))).toEqual(['customer', 'context', 'staff'])

    expect(within(items[0]).getByText('alice')).toBeInTheDocument()
    expect(within(items[0]).getByText('Customer')).toBeInTheDocument()
    expect(within(items[0]).getByText('Still broken after the update')).toBeInTheDocument()
    expect(within(items[1]).getByText('maint')).toBeInTheDocument()
    expect(within(items[1]).getByText('Maintainer')).toBeInTheDocument()
    expect(within(items[2]).getByText('Staff')).toBeInTheDocument()
  })

  it('shows answerLoops\'s own reply in its place between the customer\'s messages, labeled answerLoops', () => {
    render(
      <TicketThread
        replies={[
          reply('staff', 'Sam', 'Following up by hand', '2026-05-01T11:00:00.000Z'),
          reply('customer', 'alice', 'That did not work', '2026-05-01T10:00:00.000Z'),
          reply('ai', 'answerLoops', 'Try the reset link.', '2026-05-01T09:00:00.000Z'),
          reply('customer', 'alice', 'Still broken', '2026-05-01T08:00:00.000Z'),
        ]}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-role'))).toEqual(['customer', 'ai', 'customer', 'staff'])
    expect(within(items[1]).getByText('answerLoops', { selector: 'span.truncate' })).toBeInTheDocument()
    expect(within(items[1]).getAllByText('answerLoops')).toHaveLength(2) // the author, and the role label
    expect(within(items[1]).getByText('Try the reset link.')).toBeInTheDocument()
    expect(within(items[0]).queryByText('answerLoops')).not.toBeInTheDocument()
  })

  it('counts the messages in its heading', () => {
    const { rerender } = render(<TicketThread replies={[reply('customer', 'a', 'one', '2026-05-01T09:00:00.000Z')]} />)
    expect(screen.getByRole('heading', { name: /1 message$/ })).toBeInTheDocument()
    rerender(
      <TicketThread
        replies={[
          reply('customer', 'a', 'one', '2026-05-01T09:00:00.000Z'),
          reply('staff', 'b', 'two', '2026-05-01T09:01:00.000Z'),
        ]}
      />
    )
    expect(screen.getByRole('heading', { name: /2 messages$/ })).toBeInTheDocument()
  })

  it('renders out-of-order input oldest first', () => {
    render(
      <TicketThread
        replies={[
          reply('staff', 'Sam', 'newest', '2026-05-01T12:00:00.000Z'),
          reply('customer', 'alice', 'oldest', '2026-05-01T08:00:00.000Z'),
          reply('customer', 'bob', 'middle', '2026-05-01T10:00:00.000Z'),
        ]}
      />
    )
    const text = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(text[0]).toContain('oldest')
    expect(text[1]).toContain('middle')
    expect(text[2]).toContain('newest')
  })

  it('shows a message with an attachment line as a link, same as the opening message', () => {
    render(
      <TicketThread
        replies={[reply('customer', 'alice', 'see this\n[Attachment: shot.png] — https://files.example/shot.png', '2026-05-01T09:00:00.000Z')]}
      />
    )
    expect(screen.getByText('see this')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /shot\.png/ })).toHaveAttribute('href', 'https://files.example/shot.png')
  })
})
