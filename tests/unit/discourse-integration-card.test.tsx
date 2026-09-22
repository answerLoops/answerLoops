// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiscourseIntegrationCard } from '@/components/settings/discourse'
import {
  saveDiscourseIntegrationAction,
  deleteDiscourseIntegrationAction,
} from '@/lib/actions/integrations'

const { routerRefresh } = vi.hoisted(() => ({ routerRefresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: routerRefresh }),
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
  saveDiscourseIntegrationAction: vi.fn(),
  deleteDiscourseIntegrationAction: vi.fn(),
  saveEmailIntegrationAction: vi.fn(),
  deleteEmailIntegrationAction: vi.fn(),
  generateGoogleChatConnectCodeAction: vi.fn(),
  saveGoogleChatSettingsAction: vi.fn(),
  deleteGoogleChatIntegrationAction: vi.fn(),
  getCurrentDeploymentMode: vi.fn(async () => 'cloud'),
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

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function integrationsResponse(rows: unknown[]) {
  return { ok: true, json: async () => rows }
}

function discourseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    platform: 'discourse',
    team_id: 'https://forum.example.com',
    bot_username: 'answerloops-bot',
    channel_ids: ['12', '15'],
    escalation_role_id: null,
    confidence_threshold: 0.8,
    auto_deflect_enabled: 0,
    enabled: 1,
    ...overrides,
  }
}

describe('DiscourseIntegrationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows "Not connected" and the setup form when /api/integrations has no discourse row', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([]))
    render(<DiscourseIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(screen.getByPlaceholderText('https://forum.example.com')).toBeTruthy()
  })

  it('shows the connected summary — site URL, bot username, watched categories — for an enabled row with a team_id', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([discourseRow()]))
    render(<DiscourseIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Connected · 2 categories')).toBeTruthy())
    expect(screen.getByText('https://forum.example.com')).toBeTruthy()
    expect(screen.getByText('answerloops-bot')).toBeTruthy()
    expect(screen.getByText('12, 15')).toBeTruthy()
    expect(screen.queryByText('Not connected')).toBeNull()
  })

  it('treats an enabled row with no team_id as NOT connected (the !!integration.team_id guard)', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([discourseRow({ team_id: null })]))
    render(<DiscourseIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(screen.queryByText(/^Connected · /)).toBeNull()
    // The webhook-register block only renders in the connected view.
    expect(screen.queryByRole('button', { name: /register webhook/i })).toBeNull()
  })

  it('saves via saveDiscourseIntegrationAction, then re-fetches into the connected view and shows the manual webhook block', async () => {
    mockFetch
      .mockResolvedValueOnce(integrationsResponse([])) // mount
      .mockResolvedValueOnce(integrationsResponse([discourseRow()])) // post-save reload
    vi.mocked(saveDiscourseIntegrationAction).mockResolvedValue({
      webhookUrl: 'https://app.example.com/api/discourse/webhook',
      webhookSecret: '<generated-webhook-secret>',
    })

    const user = userEvent.setup()
    render(<DiscourseIntegrationCard />)

    await waitFor(() => expect(screen.getByPlaceholderText('https://forum.example.com')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /^update$/i }))

    await waitFor(() => expect(saveDiscourseIntegrationAction).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Connected · 2 categories')).toBeTruthy())
    expect(screen.getByText('https://app.example.com/api/discourse/webhook')).toBeTruthy()
    expect(screen.getByText('<generated-webhook-secret>')).toBeTruthy()
    expect(routerRefresh).toHaveBeenCalled()
  })

  it('"Register webhook" POSTs /api/discourse/register and toasts the returned URL', async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/api/discourse/register') {
        expect(opts?.method).toBe('POST')
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, webhookUrl: 'https://app.example.com/api/discourse/webhook' }) })
      }
      return Promise.resolve(integrationsResponse([discourseRow()]))
    })

    const user = userEvent.setup()
    render(<DiscourseIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: /register webhook/i })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /register webhook/i }))

    await waitFor(() =>
      expect(screen.getByText('Webhook registered at https://app.example.com/api/discourse/webhook')).toBeTruthy(),
    )
    expect(mockFetch).toHaveBeenCalledWith('/api/discourse/register', { method: 'POST' })
  })

  it('"Disconnect" calls deleteDiscourseIntegrationAction and returns to the not-connected state', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([discourseRow()]))
    vi.mocked(deleteDiscourseIntegrationAction).mockResolvedValue(null)

    const user = userEvent.setup()
    render(<DiscourseIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Connected · 2 categories')).toBeTruthy())
    // The Disconnect button lives in the edit form.
    await user.click(screen.getByRole('button', { name: /edit categories/i }))
    await user.click(screen.getByRole('button', { name: /disconnect/i }))

    await waitFor(() => expect(deleteDiscourseIntegrationAction).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
  })
})
