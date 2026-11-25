// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { NeedsAttention } from '@/components/dashboard/needs-attention'
import type { Ticket } from '@/types'

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: 1,
    org_ticket_number: 41,
    content: 'How do I export my data?',
    ai_summary: 'Export my data',
    source_author_name: 'tester',
    category: 'how_to',
    status: 'open',
    ...over,
  }) as Ticket

const none = { slaBreaches: 0, pendingDrafts: 0, needsReview: 0 }

describe('NeedsAttention', () => {
  it('shows an all-caught-up state when nothing needs a person', () => {
    render(<NeedsAttention counts={none} openTickets={[]} />)
    expect(screen.getByText('All caught up!')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('lists only the counts above zero, each linking to its filtered tickets, most urgent first', () => {
    render(<NeedsAttention counts={{ slaBreaches: 2, pendingDrafts: 0, needsReview: 4 }} openTickets={[]} />)
    const links = within(screen.getByRole('region', { name: 'Needs attention' })).getAllByRole('link')
    const rows = links.filter((l) => l.getAttribute('href')?.startsWith('/tickets?') && l.textContent !== 'View all open →')
    expect(rows.map((l) => l.getAttribute('href'))).toEqual(['/tickets?slaBreached=1', '/tickets?needsReview=1'])
    expect(screen.getByText('2 tickets are past the response target')).toBeInTheDocument()
    expect(screen.getByText('4 answers need a human review')).toBeInTheDocument()
    expect(screen.queryByText(/AI draft/)).toBeNull()
  })

  it('uses the singular for a count of one', () => {
    render(<NeedsAttention counts={{ slaBreaches: 1, pendingDrafts: 1, needsReview: 1 }} openTickets={[]} />)
    expect(screen.getByText('1 ticket is past the response target')).toBeInTheDocument()
    expect(screen.getByText('1 AI draft is waiting for approval')).toBeInTheDocument()
    expect(screen.getByText('1 answer needs a human review')).toBeInTheDocument()
  })

  it('lists the oldest open questions with a link to each ticket', () => {
    render(<NeedsAttention counts={none} openTickets={[ticket(), ticket({ id: 2, org_ticket_number: 42, ai_summary: null, content: 'Bot is silent' })]} />)
    expect(screen.getByRole('link', { name: /Export my data/ })).toHaveAttribute('href', '/tickets/41')
    expect(screen.getByRole('link', { name: /Bot is silent/ })).toHaveAttribute('href', '/tickets/42')
    expect(screen.queryByText('All caught up!')).toBeNull()
  })

  it('always offers a way to the full open list', () => {
    render(<NeedsAttention counts={none} openTickets={[]} />)
    expect(screen.getByRole('link', { name: 'View all open →' })).toHaveAttribute('href', '/tickets?status=open')
  })
})
