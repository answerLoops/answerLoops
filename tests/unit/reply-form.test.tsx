// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/actions/tickets', () => ({ postReplyAction: vi.fn() }))

import { ReplyForm } from '@/components/tickets/reply-form'

describe('ReplyForm', () => {
  it('no longer asks for a name', () => {
    const { container } = render(<ReplyForm ticketId={1} />)
    expect(screen.queryByLabelText('Your name')).toBeNull()
    expect(container.querySelector('input[name="staffName"]')).toBeNull()
  })

  it('says who the reply will be sent as', () => {
    render(<ReplyForm ticketId={1} replyingAs="Sarah Lee" />)
    expect(screen.getByText('Sent as Sarah Lee.')).toBeInTheDocument()
  })

  it('says nothing about a sender when the name is unknown', () => {
    render(<ReplyForm ticketId={1} replyingAs={null} />)
    expect(screen.queryByText(/^Sent as/)).toBeNull()
  })

  it('tells a Circle reviewer the reply is posted as a comment on the Circle post', () => {
    render(<ReplyForm ticketId={1} sourcePlatform="circle" />)
    expect(screen.getByRole('button', { name: 'Send reply to Circle' })).toBeInTheDocument()
    expect(screen.getByText('Posts as a comment on the Circle post')).toBeInTheDocument()
    expect(screen.queryByText(/by hand|doesn't post/)).toBeNull()
  })
})
