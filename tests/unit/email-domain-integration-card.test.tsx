// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailIntegrationCard } from '@/components/settings/email'
import {
  startEmailDomainVerificationAction,
  checkEmailDomainVerificationAction,
} from '@/app/actions/integrations'

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

function connectedIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    platform: 'email',
    bot_token: null,
    channel_ids: [],
    escalation_role_id: null,
    confidence_threshold: 0.8,
    auto_deflect_enabled: 0,
    enabled: 1,
    email_send_method: 'platform',
    ...overrides,
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

// Routes both endpoints EmailIntegrationCard fetches from a single mockFetch —
// GoogleChatIntegrationCard's tests only ever hit /api/integrations, but this
// card also hits /api/email-domain for the new "use your own domain" section.
function mockRoutes(integrations: unknown[], emailDomain: unknown = null, oauth: unknown = null) {
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/email-domain') return Promise.resolve(jsonResponse(emailDomain))
    // Mocked explicitly rather than falling through to the integrations array:
    // the card reads this endpoint to decide which delivery method is already
    // set up, and a truthy array here reads as a connected mailbox.
    if (url === '/api/email-oauth') return Promise.resolve(jsonResponse(oauth))
    return Promise.resolve(jsonResponse(integrations))
  })
}

// Delivery method is a choice now: with nothing configured the card asks which
// one before showing any setup UI. Registering a domain therefore starts by
// picking "Use your own domain" from the chooser.
async function chooseOwnDomain() {
  const card = await screen.findByRole('button', { name: /^use your own domain/i })
  fireEvent.click(card)
}

describe('EmailIntegrationCard: custom domain verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the "use your own domain" input when connected and no domain is registered yet', async () => {
    mockRoutes([connectedIntegration()], null)
    render(<EmailIntegrationCard />)
    await chooseOwnDomain()

    await waitFor(() => expect(screen.getByPlaceholderText('yourcompany.com')).toBeTruthy())
    expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy()
    // the old free-text reply-from field must be gone entirely
    expect(screen.queryByText(/reply-from address/i)).toBeNull()
  })

  it('registers a domain and shows the DNS records once pending', async () => {
    mockRoutes([connectedIntegration()], null)
    vi.mocked(startEmailDomainVerificationAction).mockImplementation(async () => {
      mockRoutes(
        [connectedIntegration()],
        {
          id: 1,
          domain: 'acme.com',
          dkim_record_name: 'resend._domainkey.acme.com',
          dkim_record_value: 'p=abc123',
          return_path_record_name: 'send.acme.com',
          return_path_record_value: 'v=spf1 include:resend.net ~all',
          dmarc_suggestion: 'v=DMARC1; p=none',
          status: 'pending',
        }
      )
      return null
    })

    const user = userEvent.setup()
    render(<EmailIntegrationCard />)
    await chooseOwnDomain()

    await waitFor(() => expect(screen.getByPlaceholderText('yourcompany.com')).toBeTruthy())
    await user.type(screen.getByPlaceholderText('yourcompany.com'), 'acme.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByText('resend._domainkey.acme.com', { exact: false })).toBeTruthy())
    expect(screen.getByText('p=abc123')).toBeTruthy()
    expect(screen.getByRole('button', { name: /check setup/i })).toBeTruthy()
  })

  it('shows the verified domain and removes the pending DNS instructions once verified', async () => {
    mockRoutes([connectedIntegration()], {
      id: 1,
      domain: 'acme.com',
      dkim_record_name: 'resend._domainkey.acme.com',
      dkim_record_value: 'p=abc123',
      return_path_record_name: 'send.acme.com',
      return_path_record_value: 'v=spf1 include:resend.net ~all',
      dmarc_suggestion: null,
      status: 'verified',
    })

    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('acme.com')).toBeTruthy())
    expect(screen.getByText(/noreply@acme\.com/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove domain/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /check setup/i })).toBeNull()
  })

  it('polls verification status on click', async () => {
    mockRoutes([connectedIntegration()], {
      id: 1,
      domain: 'acme.com',
      dkim_record_name: 'resend._domainkey.acme.com',
      dkim_record_value: 'p=abc123',
      return_path_record_name: null,
      return_path_record_value: null,
      dmarc_suggestion: null,
      status: 'pending',
    })
    vi.mocked(checkEmailDomainVerificationAction).mockResolvedValue({ status: 'pending' })

    const user = userEvent.setup()
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: /check setup/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /check setup/i }))

    await waitFor(() => expect(checkEmailDomainVerificationAction).toHaveBeenCalled())
  })
})
