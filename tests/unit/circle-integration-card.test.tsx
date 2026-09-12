// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CircleIntegrationCard } from '@/app/(dashboard)/settings/page'
import {
  saveCircleIntegrationAction,
  deleteCircleIntegrationAction,
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
  saveDiscourseIntegrationAction: vi.fn(),
  deleteDiscourseIntegrationAction: vi.fn(),
  saveCircleIntegrationAction: vi.fn(),
  deleteCircleIntegrationAction: vi.fn(),
  saveEmailIntegrationAction: vi.fn(),
  deleteEmailIntegrationAction: vi.fn(),
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

function integrationsResponse(rows: unknown[]) {
  return { ok: true, json: async () => rows }
}

function circleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    platform: 'circle',
    team_id: 'https://community.acme.com',
    bot_secret: 'inbound-secret-abc',
    channel_ids: ['12345'],
    escalation_role_id: null,
    confidence_threshold: 0.8,
    enabled: 1,
    ...overrides,
  }
}

describe('CircleIntegrationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows "Not connected" and the setup form when /api/integrations has no circle row', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([]))
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(screen.getByPlaceholderText('https://community.example.com')).toBeTruthy()
  })

  it('shows the connected view — community URL, the two kind-scoped Circle webhook URLs, and the bot_secret as the header token', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    expect(screen.getByText(/\/api\/circle\/webhook\?kind=post$/)).toBeTruthy()
    expect(screen.getByText(/\/api\/circle\/webhook\?kind=comment$/)).toBeTruthy()
    expect(screen.getByText('inbound-secret-abc')).toBeTruthy()
    expect(screen.queryByText('Not connected')).toBeNull()
  })

  it('treats a row with enabled:1 but team_id:null as NOT connected', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow({ team_id: null })]))
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(screen.queryByText(/^Connected · /)).toBeNull()
    expect(screen.queryByText(/\/api\/circle\/webhook/)).toBeNull()
  })

  it('submitting the form calls saveCircleIntegrationAction and re-fetches into the connected view', async () => {
    mockFetch
      .mockResolvedValueOnce(integrationsResponse([])) // mount
      .mockResolvedValueOnce(integrationsResponse([circleRow()])) // post-save reload
    vi.mocked(saveCircleIntegrationAction).mockResolvedValue({})

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByPlaceholderText('https://community.example.com')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() => expect(saveCircleIntegrationAction).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    expect(routerRefresh).toHaveBeenCalled()
  })

  it('"Disconnect" calls deleteCircleIntegrationAction and returns to the not-connected state', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))
    vi.mocked(deleteCircleIntegrationAction).mockResolvedValue(null)

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    // The Disconnect button lives in the edit form.
    await user.click(screen.getByRole('button', { name: /edit spaces/i }))
    await user.click(screen.getByRole('button', { name: /disconnect/i }))

    await waitFor(() => expect(deleteCircleIntegrationAction).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
  })

  it('connected view has no "Sync now" / "Register webhook" control and no auto-deflect toggle', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /sync now/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /register webhook/i })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/auto-deflect/i)).toBeNull()
  })
})
