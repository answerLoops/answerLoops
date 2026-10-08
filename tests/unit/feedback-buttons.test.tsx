// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackButtons } from '@/components/tickets/feedback-buttons'

const submit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions/feedback', () => ({ submitFeedbackAction: submit }))

const summary = { up: 3, down: 1, staffVote: null as 'up' | 'down' | null }

beforeEach(() => {
  submit.mockReset()
  submit.mockResolvedValue(null)
})

describe('FeedbackButtons', () => {
  it('shows both vote buttons and the running totals', () => {
    render(<FeedbackButtons ticketId={7} summary={summary} />)
    expect(screen.getByRole('button', { name: '👍' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '👎' })).toBeTruthy()
    expect(screen.getByText(/3 up · 1 down/)).toBeTruthy()
    expect(screen.queryByText(/your vote counted/)).toBeNull()
  })

  it('highlights only the vote the staff member already cast', () => {
    render(<FeedbackButtons ticketId={7} summary={{ ...summary, staffVote: 'up' }} />)
    expect(screen.getByRole('button', { name: '👍' }).className).toContain('border-green-300')
    expect(screen.getByRole('button', { name: '👎' }).className).not.toContain('border-red-300')
    expect(screen.getByText(/your vote counted/)).toBeTruthy()
  })

  it('submits the ticket id with the vote of the button that was pressed', async () => {
    render(<FeedbackButtons ticketId={7} summary={summary} />)
    await userEvent.click(screen.getByRole('button', { name: '👎' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    const form = submit.mock.calls[0][1] as FormData
    expect(form.get('ticketId')).toBe('7')
    expect(form.get('vote')).toBe('down')
  })

  it('shows the error the action returns', async () => {
    submit.mockResolvedValue({ error: 'Could not save your vote' })
    render(<FeedbackButtons ticketId={7} summary={summary} />)
    await userEvent.click(screen.getByRole('button', { name: '👍' }))
    expect(await screen.findByText('Could not save your vote')).toBeTruthy()
  })
})
