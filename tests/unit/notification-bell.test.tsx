// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { markAll } = vi.hoisted(() => ({ markAll: vi.fn() }))
vi.mock('@/lib/actions/notifications', () => ({ markAllNotificationsReadAction: markAll, markTicketSeenAction: vi.fn() }))

import { NotificationBell } from '@/components/notifications/notification-bell'

const fetchMock = vi.fn()

function payload(unread = 2) {
  return {
    ok: true,
    json: async () => ({
      unread,
      notifications: [
        { id: 1, ticket_id: 10, ticket_number: 7, type: 'ticket_activity', message: 'alice replied', read: 0, created_at: new Date().toISOString() },
        { id: 2, ticket_id: null, ticket_number: null, type: 'sla_breach', message: 'orphan alert', read: 1, created_at: new Date().toISOString() },
      ],
    }),
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  markAll.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const bell = () => screen.getByRole('button', { name: /^Notifications/ })

describe('NotificationBell', () => {
  it('shows the unread count, capped at 99+, and nothing at zero', () => {
    const { rerender } = render(<NotificationBell unreadCount={3} />)
    expect(screen.getByText('3')).toBeTruthy()
    rerender(<NotificationBell unreadCount={250} />)
    expect(screen.getByText('99+')).toBeTruthy()
    rerender(<NotificationBell unreadCount={0} />)
    expect(screen.queryByText('99+')).toBeNull()
    expect(bell().getAttribute('aria-label')).toBe('Notifications')
  })

  it('does not fetch until opened, then shows loading and the fetched notifications', async () => {
    fetchMock.mockResolvedValue(payload())
    render(<NotificationBell unreadCount={2} />)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(bell())
    expect(screen.getByText(/Loading/)).toBeTruthy()
    expect(await screen.findByText('alice replied')).toBeTruthy()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications')
  })

  it('links notifications with a ticket number and leaves others unlinked', async () => {
    fetchMock.mockResolvedValue(payload())
    render(<NotificationBell unreadCount={2} />)
    fireEvent.click(bell())
    const link = (await screen.findByText('alice replied')).closest('a')
    expect(link?.getAttribute('href')).toBe('/tickets/7')
    expect(screen.getByText('orphan alert').closest('a')).toBeNull()
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1)
  })

  it('shows an empty state', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ notifications: [], unread: 0 }) })
    render(<NotificationBell unreadCount={0} />)
    fireEvent.click(bell())
    expect(await screen.findByText('Nothing new yet.')).toBeTruthy()
  })

  it('shows an error and refetches on Try again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    render(<NotificationBell unreadCount={2} />)
    fireEvent.click(bell())
    expect(await screen.findByText(/Couldn.t load notifications/)).toBeTruthy()
    fetchMock.mockResolvedValueOnce(payload())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('alice replied')).toBeTruthy()
    expect(screen.queryByText(/Couldn.t load notifications/)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a network failure as an error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<NotificationBell unreadCount={1} />)
    fireEvent.click(bell())
    expect(await screen.findByText(/Couldn.t load notifications/)).toBeTruthy()
  })

  it('marks all read: calls the action, zeroes the badge and clears unread rows', async () => {
    fetchMock.mockResolvedValue(payload())
    markAll.mockResolvedValue({ ok: true })
    render(<NotificationBell unreadCount={2} />)
    fireEvent.click(bell())
    await screen.findByText('alice replied')
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(screen.queryAllByLabelText('Unread')).toHaveLength(0))
    expect(markAll).toHaveBeenCalledTimes(1)
    expect(bell().getAttribute('aria-label')).toBe('Notifications')
    expect((screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the unread state when the action fails', async () => {
    fetchMock.mockResolvedValue(payload())
    markAll.mockResolvedValue({ ok: false })
    render(<NotificationBell unreadCount={2} />)
    fireEvent.click(bell())
    await screen.findByText('alice replied')
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(markAll).toHaveBeenCalled())
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1)
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unread')
  })

  it('disables Mark all read when nothing is unread', async () => {
    fetchMock.mockResolvedValue(payload(0))
    render(<NotificationBell unreadCount={0} />)
    fireEvent.click(bell())
    await screen.findByText('alice replied')
    expect((screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes on Escape and on an outside mousedown, but not on an inside one', async () => {
    fetchMock.mockResolvedValue(payload())
    render(<NotificationBell unreadCount={2} />)
    fireEvent.click(bell())
    await screen.findByText('alice replied')
    fireEvent.mouseDown(screen.getByText('alice replied'))
    expect(screen.queryByText('alice replied')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('alice replied')).toBeNull()

    fireEvent.click(bell())
    await screen.findByText('alice replied')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('alice replied')).toBeNull()
  })

  it('closes when a notification link is clicked', async () => {
    fetchMock.mockResolvedValue(payload())
    render(<NotificationBell unreadCount={2} />)
    fireEvent.click(bell())
    fireEvent.click((await screen.findByText('alice replied')).closest('a') as HTMLElement)
    expect(screen.queryByText('alice replied')).toBeNull()
  })
})
