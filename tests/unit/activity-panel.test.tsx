// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityPanel } from '@/components/dashboard/activity-panel'
import { VIEW_ALL_TICKETS_ID } from '@/components/dashboard/activity-ids'
import type { Ticket } from '@/types'

const bulk = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions/notifications', () => ({ markAllTicketsSeenAction: bulk }))

afterEach(() => {
  cleanup()
  bulk.mockReset()
})

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

describe('bulk activity confirmation', () => {
  const snapshot = '2026-10-02T00:00:00.123456Z'
  const proof = '<dashboard-snapshot-proof>'

  async function open(total: number) {
    const user = userEvent.setup()
    const panel = render(<ActivityPanel tickets={[ticket({})]} total={total} snapshot={snapshot} proof={proof} />)
    expect(screen.queryByRole('button', { name: 'Mark all as seen' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Activity,/ }))
    const trigger = screen.getByRole('button', { name: 'Mark all as seen' })
    await user.click(trigger)
    return { user, trigger, panel }
  }

  it.each(['Cancel', 'Escape'])('dismisses with %s and restores focus without mutating', async (method) => {
    const { user, trigger } = await open(200)
    const group = screen.getByRole('group', { name: 'Mark 200 tickets as seen?' })
    expect(group).toHaveTextContent('for your whole team')
    const cancel = within(group).getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveFocus()
    if (method === 'Cancel') await user.click(cancel)
    else await user.keyboard('{Escape}')
    expect(group).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(bulk).not.toHaveBeenCalled()
  })

  it('keeps the confirmed snapshot through a refresh and reports the actual count after the panel disappears', async () => {
    const { panel } = await open(200)
    const deferred = Promise.withResolvers<{ ok: true; count: number }>()
    bulk.mockReturnValue(deferred.promise)
    const confirm = screen.getByRole('button', { name: 'Confirm mark all as seen' })
    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(bulk).toHaveBeenCalledExactlyOnceWith(snapshot, proof)
    expect(confirm).toBeDisabled()
    panel.rerender(<ActivityPanel tickets={[ticket({})]} total={201} snapshot="different-snapshot" proof="different-proof" />)
    panel.rerender(<ActivityPanel tickets={[]} total={0} snapshot={snapshot} />)
    panel.rerender(<ActivityPanel tickets={[ticket({})]} total={1} snapshot="new-snapshot" proof="new-proof" />)
    expect(screen.queryByRole('group', { name: /as seen/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mark all as seen' })).toBeDisabled()
    await act(async () => deferred.resolve({ ok: true, count: 198 }))
    panel.rerender(<ActivityPanel tickets={[]} total={0} snapshot={snapshot} />)
    expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Marked 198 tickets as seen.')
  })

  it('keeps the confirmation pending through Escape and panel toggles', async () => {
    const { user } = await open(1)
    const deferred = Promise.withResolvers<{ ok: true; count: number }>()
    bulk.mockReturnValueOnce(deferred.promise)
    const toggle = screen.getByRole('button', { name: /^Activity,/ })
    await user.click(screen.getByRole('button', { name: 'Confirm mark all as seen' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Marking tickets…' })).toBeDisabled()
    await user.click(toggle)
    expect(screen.queryByRole('group')).toBeNull()
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Marking tickets…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await act(async () => deferred.resolve({ ok: true, count: 1 }))
    expect(bulk).toHaveBeenCalledOnce()
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Marked 1 ticket as seen.')
    expect(toggle).toHaveFocus()
  })

  it('asks for confirmation again if a refresh changes the snapshot before submitting', async () => {
    const { user, panel } = await open(200)
    panel.rerender(<ActivityPanel tickets={[ticket({})]} total={201} snapshot="updated-snapshot" proof="updated-proof" />)
    expect(screen.queryByRole('group')).toBeNull()
    expect(bulk).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Mark all as seen' }))
    expect(screen.getByRole('group', { name: 'Mark 201 tickets as seen?' })).toBeVisible()
    bulk.mockResolvedValueOnce({ ok: true, count: 201 })
    await user.click(screen.getByRole('button', { name: 'Confirm mark all as seen' }))
    expect(bulk).toHaveBeenCalledExactlyOnceWith('updated-snapshot', 'updated-proof')
  })

  it('discards an unused confirmation when a refresh empties and then refills the backlog', async () => {
    const { user, panel } = await open(200)
    expect(screen.getByRole('group', { name: 'Mark 200 tickets as seen?' })).toBeVisible()
    panel.rerender(<ActivityPanel tickets={[]} total={0} snapshot={snapshot} />)
    expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull()
    panel.rerender(<ActivityPanel tickets={[ticket({})]} total={1} snapshot="new-snapshot" proof="new-proof" />)
    expect(screen.queryByRole('group', { name: /as seen/ })).toBeNull()
    const trigger = screen.getByRole('button', { name: 'Mark all as seen' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(screen.getByRole('group', { name: 'Mark 1 ticket as seen?' })).toBeVisible()
    bulk.mockResolvedValue({ ok: true, count: 1 })
    await user.click(screen.getByRole('button', { name: 'Confirm mark all as seen' }))
    expect(bulk).toHaveBeenCalledExactlyOnceWith('new-snapshot', 'new-proof')
  })

  it.each(['open', 'pending'])('moves focus to View all tickets when a refresh removes the %s confirmation', async (phase) => {
    function dashboard(hasActivity: boolean) {
      return (
        <>
          <a id={VIEW_ALL_TICKETS_ID} href="/tickets">View all tickets</a>
          <ActivityPanel
            tickets={hasActivity ? [ticket({})] : []}
            total={hasActivity ? 1 : 0}
            snapshot={hasActivity ? snapshot : undefined}
            proof={hasActivity ? proof : undefined}
          />
        </>
      )
    }

    const user = userEvent.setup()
    const panel = render(dashboard(true))
    const fallback = screen.getByRole('link', { name: 'View all tickets' })
    await user.click(screen.getByRole('button', { name: /^Activity,/ }))
    await user.click(screen.getByRole('button', { name: 'Mark all as seen' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    const deferred = Promise.withResolvers<{ ok: false }>()
    if (phase === 'pending') {
      bulk.mockReturnValueOnce(deferred.promise)
      await user.click(screen.getByRole('button', { name: 'Confirm mark all as seen' }))
      expect(screen.getByRole('button', { name: 'Marking tickets…' })).toBeDisabled()
    }

    panel.rerender(dashboard(false))
    expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull()
    expect(fallback).toHaveFocus()
    if (phase === 'pending') {
      await act(async () => deferred.resolve({ ok: false }))
      expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t mark tickets as seen.')
      expect(fallback).toHaveFocus()
    }
  })

  it.each(['rejected', 'denied'])('reports a %s request and lets the person retry', async (failure) => {
    const { user } = await open(1)
    expect(screen.getByRole('group', { name: 'Mark 1 ticket as seen?' })).toBeVisible()
    if (failure === 'rejected') bulk.mockRejectedValueOnce(new Error('Network failed'))
    else bulk.mockResolvedValueOnce({ ok: false })
    const confirm = screen.getByRole('button', { name: 'Confirm mark all as seen' })
    await user.click(confirm)
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t mark tickets as seen. Try again.')
    expect(confirm).toBeEnabled()
    expect(confirm).toHaveFocus()
    bulk.mockResolvedValueOnce({ ok: true, count: 1 })
    await user.click(confirm)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Marked 1 ticket as seen.')
    expect(screen.getByRole('status')).toHaveFocus()
  })
})

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
