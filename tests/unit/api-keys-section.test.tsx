// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiKeysSection } from '@/app/(dashboard)/settings/page'
import { createApiKeyAction, revokeApiKeyAction } from '@/lib/actions/api-keys'
import { ALL_SCOPES } from '@/lib/agent/scopes'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/actions/api-keys', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}))

vi.mock('@/lib/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/lib/actions/notion', () => ({ saveNotionConnectionAction: vi.fn(), deleteNotionConnectionAction: vi.fn() }))
vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  removeDiscordGuildAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(),
  deleteSlackIntegrationAction: vi.fn(),
  saveTelegramIntegrationAction: vi.fn(),
  deleteTelegramIntegrationAction: vi.fn(),
  saveEmailIntegrationAction: vi.fn(),
  deleteEmailIntegrationAction: vi.fn(),
}))
vi.mock('@/lib/actions/invitations', () => ({
  sendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  removeMemberAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}))
vi.mock('@/lib/actions/widget', () => ({
  getWidgetTokenAction: vi.fn(),
  regenerateWidgetTokenAction: vi.fn(),
}))
vi.mock('@/lib/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(),
  clearAIConfigAction: vi.fn(),
}))
vi.mock('@/lib/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/lib/actions/account', () => ({
  deleteAccountAction: vi.fn(),
  getCurrentOrgName: vi.fn(async () => null),
}))

const activeKeys = [
  {
    id: 11,
    name: 'Claude Code',
    key_prefix: 'al_live_first',
    scopes: [...ALL_SCOPES],
    created_at: '2026-07-20T12:00:00.000Z',
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
  },
  {
    id: 12,
    name: 'Cursor',
    key_prefix: 'al_live_second',
    scopes: ['kb:read', 'faq:read'],
    created_at: '2026-07-21T12:00:00.000Z',
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
  },
]

// userEvent.setup() installs its own navigator.clipboard stub, so the fake must
// be planted after setup() to win.
function withClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

describe('API keys settings section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: activeKeys, can_manage: true }),
      }),
    )
  })

  it('removes a revoked key row immediately after the server confirms success', async () => {
    vi.mocked(revokeApiKeyAction).mockResolvedValue(null)
    const user = userEvent.setup()
    render(<ApiKeysSection />)

    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('Cursor')).toBeInTheDocument()

    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' })
    await user.click(revokeButtons[0])
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(screen.queryByText('Claude Code')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Cursor')).toBeInTheDocument()
    expect(revokeApiKeyAction).toHaveBeenCalledTimes(1)

    const submitted = vi.mocked(revokeApiKeyAction).mock.calls[0][1] as FormData
    expect(submitted.get('keyId')).toBe('11')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the key visible and announces the server error when revocation fails', async () => {
    vi.mocked(revokeApiKeyAction).mockResolvedValue({ error: 'Key could not be revoked.' })
    const user = userEvent.setup()
    render(<ApiKeysSection />)

    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Key could not be revoked.')
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('hides create and revoke controls from a member who cannot manage keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: activeKeys, can_manage: false }),
      }),
    )
    render(<ApiKeysSection />)

    // Keys stay visible — a member can see what exists, just not change it.
    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText(/Only workspace owners and admins can create or revoke API keys/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create key' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
  })

  it('shows create and revoke controls to an owner or admin', async () => {
    render(<ApiKeysSection />)

    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(screen.queryByText(/Only workspace owners and admins/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create key' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(2)
  })

  it('renders no manage controls before the viewer role is known, so they never flash in', () => {
    // fetch is still pending on first paint.
    render(<ApiKeysSection />)
    expect(screen.queryByRole('button', { name: 'Create key' })).not.toBeInTheDocument()
  })

  it('offers one permission checkbox per scope, all checked by default', async () => {
    render(<ApiKeysSection />)
    await screen.findByRole('button', { name: 'Create key' })

    for (const scope of ALL_SCOPES) {
      const box = screen.getByRole('checkbox', { name: new RegExp(scope) })
      expect(box).toBeChecked()
    }
  })

  it('submits only the scopes left checked when the key is created', async () => {
    vi.mocked(createApiKeyAction).mockResolvedValue({ plaintextKey: 'al_live_generated' })
    const user = userEvent.setup()
    render(<ApiKeysSection />)
    await screen.findByRole('button', { name: 'Create key' })

    await user.type(screen.getByPlaceholderText(/Claude Code \(laptop\)/), 'Read-only bot')
    // Uncheck the two write scopes.
    await user.click(screen.getByRole('checkbox', { name: /tickets:write/ }))
    await user.click(screen.getByRole('checkbox', { name: /answers:write/ }))
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    await waitFor(() => expect(createApiKeyAction).toHaveBeenCalledTimes(1))
    const fd = vi.mocked(createApiKeyAction).mock.calls[0][1] as FormData
    expect(fd.getAll('scopes')).toEqual(['kb:read', 'faq:read', 'tickets:read'])
  })

  it('surfaces the server error when every permission is unchecked', async () => {
    vi.mocked(createApiKeyAction).mockResolvedValue({ error: 'Select at least one permission for this key.' })
    const user = userEvent.setup()
    render(<ApiKeysSection />)
    await screen.findByRole('button', { name: 'Create key' })

    await user.type(screen.getByPlaceholderText(/Claude Code \(laptop\)/), 'Broken key')
    for (const scope of ALL_SCOPES) {
      await user.click(screen.getByRole('checkbox', { name: new RegExp(scope) }))
    }
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByText('Select at least one permission for this key.')).toBeInTheDocument()
  })

  it('labels a full-access key "Full access" and lists a partial key\'s scopes', async () => {
    render(<ApiKeysSection />)
    expect(await screen.findByText('Full access')).toBeInTheDocument()
    expect(screen.getByText('kb:read, faq:read')).toBeInTheDocument()
  })

  it('shows the "Onboard your agent" card and its Copy command button before any key state is known', () => {
    // fetch is still pending on first paint — the onboarding card must not wait on it.
    render(<ApiKeysSection />)
    expect(screen.getByText('Onboard your agent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument()
  })

  it('copies the skill install command to the clipboard when "Copy command" is clicked', async () => {
    const user = userEvent.setup()
    const writeText = withClipboard()
    render(<ApiKeysSection />)

    await user.click(screen.getByRole('button', { name: 'Copy command' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const copiedText = writeText.mock.calls[0][0] as string
    expect(copiedText).toContain('npx @answerloops/agent-sdk skills answerloops-operate')
  })

  it('flips the Copy command label to "✓ Copied" after a click, then reverts it after 2 seconds', async () => {
    vi.useFakeTimers()
    withClipboard()
    render(<ApiKeysSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))

    // Flush the microtask queue so the clipboard promise's .then() runs before
    // we assert — fake timers stop waitFor's own polling from doing this for us.
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: '✓ Copied' })).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument()
    vi.useRealTimers()
  })
})
