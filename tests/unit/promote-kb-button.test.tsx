// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ promoteToKBAction: vi.fn() }))
vi.mock('@/lib/actions/kb', () => ({ promoteToKBAction: h.promoteToKBAction }))

describe('PromoteKBButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.promoteToKBAction.mockResolvedValue(null)
  })

  it('shows the promote button to someone who can publish', async () => {
    const { PromoteKBButton } = await import('@/components/tickets/promote-kb-button')
    render(<PromoteKBButton ticketId={3} />)
    expect(screen.getByRole('button', { name: 'Promote to KB' })).toBeTruthy()
  })

  it('replaces the button with a note for a member', async () => {
    const { PromoteKBButton } = await import('@/components/tickets/promote-kb-button')
    render(<PromoteKBButton ticketId={3} canPromote={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/only owners and admins/i)).toBeTruthy()
  })

  it('links to the article once the ticket is in the knowledge base, whatever the role', async () => {
    const { PromoteKBButton } = await import('@/components/tickets/promote-kb-button')
    render(<PromoteKBButton ticketId={3} articleId={9} canPromote={false} />)
    expect(screen.getByText(/in knowledge base/i)).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/kb')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/only owners and admins/i)).toBeNull()
  })

  it('shows the button when canPromote is explicitly true', async () => {
    const { PromoteKBButton } = await import('@/components/tickets/promote-kb-button')
    render(<PromoteKBButton ticketId={3} canPromote />)
    expect(screen.getByRole('button', { name: 'Promote to KB' })).toBeTruthy()
    expect(screen.queryByText(/only owners and admins/i)).toBeNull()
  })

  it('calls the action with the ticket id when clicked and shows no error on success', async () => {
    const user = userEvent.setup()
    const { PromoteKBButton } = await import('@/components/tickets/promote-kb-button')
    render(<PromoteKBButton ticketId={42} />)
    await user.click(screen.getByRole('button', { name: 'Promote to KB' }))
    await waitFor(() => expect(h.promoteToKBAction).toHaveBeenCalledOnce())
    expect((h.promoteToKBAction.mock.calls[0][1] as FormData).get('ticketId')).toBe('42')
    expect(screen.queryByText(/ticket not found|resolved/i)).toBeNull()
    await waitFor(() => expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false))
  })

  it('shows the error returned by the action', async () => {
    const user = userEvent.setup()
    h.promoteToKBAction.mockResolvedValue({ error: 'Only resolved tickets can be promoted' })
    const { PromoteKBButton } = await import('@/components/tickets/promote-kb-button')
    render(<PromoteKBButton ticketId={3} />)
    await user.click(screen.getByRole('button', { name: 'Promote to KB' }))
    expect(await screen.findByText('Only resolved tickets can be promoted')).toBeTruthy()
  })

  it('shows a working state and disables the button while the action runs', async () => {
    const user = userEvent.setup()
    let finish!: (v: unknown) => void
    h.promoteToKBAction.mockReturnValue(new Promise((r) => { finish = r }))
    const { PromoteKBButton } = await import('@/components/tickets/promote-kb-button')
    render(<PromoteKBButton ticketId={3} />)
    await user.click(screen.getByRole('button', { name: 'Promote to KB' }))
    const busy = await screen.findByRole('button', { name: /promoting/i })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    finish(null)
    expect(await screen.findByRole('button', { name: 'Promote to KB' })).toBeTruthy()
  })
})
