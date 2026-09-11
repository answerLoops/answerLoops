// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailIntegrationCard } from '@/app/(dashboard)/settings/page'
import { removeEmailDomainAction } from '@/app/actions/integrations'

/**
 * Removing a verified sending domain deletes it at the email provider, not
 * only in answerLoops, and it cannot be undone from here — re-adding means
 * verifying from scratch with new DNS records and waiting for propagation.
 *
 * It used to fire on a single click with no confirmation. These tests pin the
 * confirmation step, since the cost of an accidental click is paid outside this
 * system and can't be reversed by us.
 */

const { routerRefresh } = vi.hoisted(() => ({ routerRefresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: routerRefresh }),
}))

vi.mock('@/app/actions/api-keys', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}))
vi.mock('@/app/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/app/actions/notion', () => ({ saveNotionConnectionAction: vi.fn(), deleteNotionConnectionAction: vi.fn() }))
vi.mock('@/app/actions/integrations', () => ({
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
  startEmailDomainVerificationAction: vi.fn(),
  checkEmailDomainVerificationAction: vi.fn(),
  removeEmailDomainAction: vi.fn(),
  disconnectOauthAction: vi.fn(),
  generateGoogleChatConnectCodeAction: vi.fn(),
  saveGoogleChatSettingsAction: vi.fn(),
  deleteGoogleChatIntegrationAction: vi.fn(),
  getCurrentDeploymentMode: vi.fn(async () => 'cloud'),
}))
vi.mock('@/app/actions/invitations', () => ({
  sendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  removeMemberAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}))
vi.mock('@/app/actions/widget', () => ({
  getWidgetTokenAction: vi.fn(),
  regenerateWidgetTokenAction: vi.fn(),
}))
vi.mock('@/app/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(),
  clearAIConfigAction: vi.fn(),
}))
vi.mock('@/app/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/app/actions/account', () => ({
  deleteAccountAction: vi.fn(),
  getCurrentOrgName: vi.fn(async () => null),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const DOMAIN = 'mail.acme.test'

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

function mockRoutes(emailDomain: unknown) {
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/email-domain') return Promise.resolve(jsonResponse(emailDomain))
    return Promise.resolve(
      jsonResponse([
        {
          id: 1,
          platform: 'email',
          bot_token: null,
          channel_ids: [],
          escalation_role_id: null,
          confidence_threshold: 0.8,
          auto_deflect_enabled: 0,
          enabled: 1,
          email_send_method: 'domain',
        },
      ])
    )
  })
}

async function renderWithVerifiedDomain() {
  mockRoutes({ domain: DOMAIN, status: 'verified', records: [] })
  render(<EmailIntegrationCard />)
  await screen.findByText(DOMAIN)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
})

describe('removing a verified domain requires confirmation', () => {
  it('does not remove anything on the first click', async () => {
    const user = userEvent.setup()
    await renderWithVerifiedDomain()

    await user.click(screen.getByRole('button', { name: /remove domain/i }))

    // The click opens the confirmation; it must not have acted yet.
    expect(removeEmailDomainAction).not.toHaveBeenCalled()
  })

  it('explains that the deletion reaches the provider and cannot be undone', async () => {
    const user = userEvent.setup()
    await renderWithVerifiedDomain()
    await user.click(screen.getByRole('button', { name: /remove domain/i }))

    // Scoped to the dialog: the same warning also appears inline on the card,
    // which is deliberate — this asserts the dialog itself carries it.
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/cannot be undone/i)).toBeTruthy()
    expect(dialog.getByText(/deletes the domain from your email provider/i)).toBeTruthy()
    expect(dialog.getByText(/verifying it from scratch/i)).toBeTruthy()
  })

  it('keeps the confirm button disabled until the domain is typed exactly', async () => {
    const user = userEvent.setup()
    await renderWithVerifiedDomain()
    await user.click(screen.getByRole('button', { name: /remove domain/i }))

    const confirm = screen.getByRole('button', { name: /^remove domain$/i })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    const input = screen.getByPlaceholderText(DOMAIN)
    await user.type(input, 'mail.acme')
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    await user.type(input, '.test')
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  })

  it('removes only after the exact domain is confirmed', async () => {
    const user = userEvent.setup()
    vi.mocked(removeEmailDomainAction).mockResolvedValue(null)
    await renderWithVerifiedDomain()
    await user.click(screen.getByRole('button', { name: /remove domain/i }))

    await user.type(screen.getByPlaceholderText(DOMAIN), DOMAIN)
    await user.click(screen.getByRole('button', { name: /^remove domain$/i }))

    await waitFor(() => expect(removeEmailDomainAction).toHaveBeenCalledOnce())
  })

  it('cancelling closes the dialog without removing', async () => {
    const user = userEvent.setup()
    await renderWithVerifiedDomain()
    await user.click(screen.getByRole('button', { name: /remove domain/i }))

    await user.type(screen.getByPlaceholderText(DOMAIN), DOMAIN)
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByPlaceholderText(DOMAIN)).toBeNull())
    expect(removeEmailDomainAction).not.toHaveBeenCalled()
  })

  it('the warning is visible before opening the dialog too', async () => {
    // Someone scanning the settings page should learn the cost without having
    // to click a destructive-looking button to find out.
    await renderWithVerifiedDomain()
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy()
  })
})
