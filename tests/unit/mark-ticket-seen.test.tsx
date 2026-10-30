// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const { seen } = vi.hoisted(() => ({ seen: vi.fn() }))
vi.mock('@/lib/actions/notifications', () => ({ markTicketSeenAction: seen, markAllNotificationsReadAction: vi.fn() }))

import { MarkTicketSeen } from '@/components/notifications/mark-ticket-seen'

beforeEach(() => seen.mockReset())
afterEach(cleanup)

describe('MarkTicketSeen', () => {
  it('renders nothing and marks the ticket seen on mount', () => {
    const { container } = render(<MarkTicketSeen ticketNumber={12} />)
    expect(container).toBeEmptyDOMElement()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledWith(12)
  })

  it('does not call again on a re-render with the same ticket', () => {
    const { rerender } = render(<MarkTicketSeen ticketNumber={12} />)
    rerender(<MarkTicketSeen ticketNumber={12} />)
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('calls again when the ticket number changes', () => {
    const { rerender } = render(<MarkTicketSeen ticketNumber={12} />)
    rerender(<MarkTicketSeen ticketNumber={13} />)
    expect(seen).toHaveBeenCalledTimes(2)
    expect(seen).toHaveBeenLastCalledWith(13)
  })
})
