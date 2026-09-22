// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RestoreAccountButton } from '@/components/dashboard/restore-account-button'
import { restoreAccountAction } from '@/app/actions/account'

vi.mock('@/app/actions/account', () => ({
  restoreAccountAction: vi.fn(),
}))

describe('RestoreAccountButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls restoreAccountAction when the button is clicked', async () => {
    vi.mocked(restoreAccountAction).mockResolvedValue(null)
    const user = userEvent.setup()
    render(<RestoreAccountButton />)

    await user.click(screen.getByRole('button', { name: 'Restore my account' }))

    await waitFor(() => {
      expect(restoreAccountAction).toHaveBeenCalledTimes(1)
    })
  })

  it('shows a disabled "Restoring…" label while the action is pending', async () => {
    let resolveAction!: (value: { error?: string } | null) => void
    vi.mocked(restoreAccountAction).mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve
      })
    )
    const user = userEvent.setup()
    render(<RestoreAccountButton />)

    await user.click(screen.getByRole('button', { name: 'Restore my account' }))

    const pendingButton = await screen.findByRole('button', { name: 'Restoring…' })
    expect(pendingButton).toBeDisabled()

    resolveAction(null)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore my account' })).not.toBeDisabled()
    })
  })

  it('renders the server error message when the action fails', async () => {
    vi.mocked(restoreAccountAction).mockResolvedValue({ error: 'Account could not be restored.' })
    const user = userEvent.setup()
    render(<RestoreAccountButton />)

    await user.click(screen.getByRole('button', { name: 'Restore my account' }))

    expect(await screen.findByText('Account could not be restored.')).toBeInTheDocument()
  })

  it('renders no error message when the action succeeds', async () => {
    vi.mocked(restoreAccountAction).mockResolvedValue(null)
    const user = userEvent.setup()
    render(<RestoreAccountButton />)

    await user.click(screen.getByRole('button', { name: 'Restore my account' }))

    await waitFor(() => {
      expect(restoreAccountAction).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText(/could not be restored/)).not.toBeInTheDocument()
    expect(document.querySelector('.text-red-500')).not.toBeInTheDocument()
  })
})
