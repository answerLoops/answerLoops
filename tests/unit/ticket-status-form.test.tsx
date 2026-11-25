// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/actions/tickets', () => ({ updateTicketStatusAction: vi.fn() }))

import { TicketStatusForm } from '@/components/tickets/ticket-status-form'

describe('TicketStatusForm', () => {
  it('asks only for the status and optional notes, not a name', () => {
    const { container } = render(<TicketStatusForm ticketId={4} currentStatus="open" />)
    expect(screen.getByLabelText('Status')).toHaveValue('open')
    expect(screen.getByLabelText('Resolution notes (optional)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your name')).toBeNull()
    expect(container.querySelector('input[name="staffName"]')).toBeNull()
    expect(container.querySelector('input[name="ticketId"]')).toHaveValue('4')
  })
})
