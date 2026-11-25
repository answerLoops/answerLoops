// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))

import { TicketActionsMenu } from '@/components/tickets/ticket-actions-menu'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
})

const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'Ticket actions' }))

describe('TicketActionsMenu', () => {
  it('keeps Delete out of sight until the menu is opened', async () => {
    render(<TicketActionsMenu ticketId={5} />)
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
    await openMenu()
    expect(screen.getByRole('menuitem', { name: 'Delete ticket…' })).toBeInTheDocument()
  })

  it('asks before deleting, and does nothing until confirmed', async () => {
    render(<TicketActionsMenu ticketId={5} />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete ticket…' }))
    expect(screen.getByText('Delete this ticket?')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes the ticket and returns to the list once confirmed', async () => {
    render(<TicketActionsMenu ticketId={5} />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete ticket…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/tickets'))
    expect(fetchMock).toHaveBeenCalledWith('/api/tickets/5', { method: 'DELETE' })
  })

  it('Cancel closes the menu without deleting', async () => {
    render(<TicketActionsMenu ticketId={5} />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete ticket…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Escape closes the menu', async () => {
    render(<TicketActionsMenu ticketId={5} />)
    await openMenu()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a click outside closes the menu', async () => {
    render(<div><span>elsewhere</span><TicketActionsMenu ticketId={5} /></div>)
    await openMenu()
    await userEvent.click(screen.getByText('elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('reports whether the menu is expanded', async () => {
    render(<TicketActionsMenu ticketId={5} />)
    const button = screen.getByRole('button', { name: 'Ticket actions' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })
})
