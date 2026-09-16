// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailIntegrationCard } from '@/components/settings/email'
import { disconnectOauthAction } from '@/app/actions/integrations'

const { routerRefresh, mockSearchParams } = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
  mockSearchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
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

function connectedIntegration() {
  return {
    id: 1,
    platform: 'email',
    bot_token: null,
    channel_ids: [],
    escalation_role_id: null,
    confidence_threshold: 0.8,
    auto_deflect_enabled: 0,
    enabled: 1,
    email_send_method: 'oauth',
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

function mockRoutes(opts: { emailDomain?: unknown; oauth?: unknown } = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/email-domain') return Promise.resolve(jsonResponse(opts.emailDomain ?? null))
    if (url === '/api/email-oauth') return Promise.resolve(jsonResponse(opts.oauth ?? null))
    return Promise.resolve(jsonResponse([connectedIntegration()]))
  })
}

describe('EmailIntegrationCard: OAuth mailbox connection (Gmail + Outlook)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.forEach((_v, k) => mockSearchParams.delete(k))
  })

  it('offers both Connect Gmail and Connect Outlook when no connection exists yet', async () => {
    mockRoutes()
    render(<EmailIntegrationCard />)
    // With nothing configured the card asks which delivery method to use
    // before showing any setup UI, so the mailbox path has to be chosen first.
    fireEvent.click(await screen.findByRole('button', { name: /^connect a mailbox/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /connect gmail/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /connect outlook/i })).toBeTruthy()

    const gmailLink = screen.getByRole('button', { name: /connect gmail/i }).closest('a')
    expect(gmailLink?.getAttribute('href')).toBe('/api/email/gmail/install')
    const outlookLink = screen.getByRole('button', { name: /connect outlook/i }).closest('a')
    expect(outlookLink?.getAttribute('href')).toBe('/api/email/outlook/install')
  })

  it('shows the connected Gmail mailbox address and a Disconnect button', async () => {
    mockRoutes({ oauth: { id: 1, mailbox_address: 'support@gmail.com', provider: 'gmail', status: 'connected' } })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('support@gmail.com')).toBeTruthy())
    expect(screen.getByText('Gmail mailbox')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /disconnect/i }).length).toBeGreaterThan(0)
  })

  it('shows the connected Outlook mailbox address', async () => {
    mockRoutes({ oauth: { id: 1, mailbox_address: 'support@outlook.com', provider: 'outlook', status: 'connected' } })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('support@outlook.com')).toBeTruthy())
    expect(screen.getByText('Outlook mailbox')).toBeTruthy()
  })

  it('disconnects and returns to the not-connected state, offering both providers again', async () => {
    mockRoutes({ oauth: { id: 1, mailbox_address: 'support@gmail.com', provider: 'gmail', status: 'connected' } })
    vi.mocked(disconnectOauthAction).mockResolvedValue(null)

    const user = userEvent.setup()
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('support@gmail.com')).toBeTruthy())
    const oauthSection = screen.getByText('support@gmail.com').closest('div.space-y-2')
    const disconnectButton = oauthSection?.querySelector('button')
    expect(disconnectButton).toBeTruthy()
    await user.click(disconnectButton!)

    await waitFor(() => expect(disconnectOauthAction).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /connect outlook/i })).toBeTruthy())
  })

  it('shows a distinct reconnect state, with the right provider link, when the connection was revoked', async () => {
    mockRoutes({ oauth: { id: 1, mailbox_address: 'support@outlook.com', provider: 'outlook', status: 'disconnected' } })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText(/connection.*lost/i)).toBeTruthy())
    const reconnectButton = screen.getByRole('button', { name: /reconnect outlook/i })
    expect(reconnectButton).toBeTruthy()
    expect(reconnectButton.closest('a')?.getAttribute('href')).toBe('/api/email/outlook/install')
  })

  it('surfaces a toast when the Outlook OAuth callback redirects back with outlook_connected=1', async () => {
    mockSearchParams.set('outlook_connected', '1')
    mockRoutes({ oauth: { id: 1, mailbox_address: 'support@outlook.com', provider: 'outlook', status: 'connected' } })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Outlook connected')).toBeTruthy())
  })

  it('surfaces a toast when the Gmail OAuth callback redirects back with gmail_connected=1', async () => {
    mockSearchParams.set('gmail_connected', '1')
    mockRoutes({ oauth: { id: 1, mailbox_address: 'support@gmail.com', provider: 'gmail', status: 'connected' } })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Gmail connected')).toBeTruthy())
  })
})
