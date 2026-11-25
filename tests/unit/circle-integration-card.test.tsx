// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CircleIntegrationCard } from '@/components/settings/circle'
import {
  saveCircleIntegrationAction,
  deleteCircleIntegrationAction,
  rotateCircleSecretAction,
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
  saveCircleIntegrationAction: vi.fn(),
  deleteCircleIntegrationAction: vi.fn(),
  rotateCircleSecretAction: vi.fn(),
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
    // Drop any queued one-off responses a previous test left unconsumed.
    mockFetch.mockReset()
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
    expect(screen.getByText(/\/api\/circle\/webhook\?kind=post&token=inbound-secret-abc$/)).toBeTruthy()
    expect(screen.getByText(/\/api\/circle\/webhook\?kind=comment&token=inbound-secret-abc$/)).toBeTruthy()
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

  it('"Disconnect" asks for confirmation, then calls deleteCircleIntegrationAction, refreshes, and returns to the not-connected state', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))
    vi.mocked(deleteCircleIntegrationAction).mockResolvedValue(null)

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    // The Disconnect button lives in the edit form.
    await user.click(screen.getByRole('button', { name: /edit spaces/i }))
    await user.click(screen.getByRole('button', { name: /^disconnect$/i }))

    // The first click only opens the confirm step.
    expect(screen.getByText(/disconnect circle\?/i)).toBeTruthy()
    expect(screen.getByText(/new posts stop creating tickets/i)).toBeTruthy()
    expect(screen.getByText(/both workflow urls will need updating/i)).toBeTruthy()
    expect(deleteCircleIntegrationAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /yes, disconnect/i }))

    await waitFor(() => expect(deleteCircleIntegrationAction).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(routerRefresh).toHaveBeenCalled()
  })

  it('cancelling the disconnect confirm leaves the integration connected and calls nothing', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /edit spaces/i }))
    await user.click(screen.getByRole('button', { name: /^disconnect$/i }))
    await user.click(screen.getByRole('button', { name: /keep connected/i }))

    expect(screen.queryByText(/disconnect circle\?/i)).toBeNull()
    expect(deleteCircleIntegrationAction).not.toHaveBeenCalled()
    expect(routerRefresh).not.toHaveBeenCalled()
    expect(screen.queryByText('Not connected')).toBeNull()
  })

  it('a failed disconnect shows the error and keeps the integration connected', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))
    vi.mocked(deleteCircleIntegrationAction).mockResolvedValue({ error: 'You do not have permission to do that.' })

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /edit spaces/i }))
    await user.click(screen.getByRole('button', { name: /^disconnect$/i }))
    await user.click(screen.getByRole('button', { name: /yes, disconnect/i }))

    await waitFor(() => expect(screen.getByText('You do not have permission to do that.')).toBeTruthy())
    expect(screen.queryByText('Not connected')).toBeNull()
    expect(routerRefresh).not.toHaveBeenCalled()
  })

  it('"Rotate secret" asks for confirmation, calls rotateCircleSecretAction, and shows the new secret with both Workflow URLs', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))
    vi.mocked(rotateCircleSecretAction).mockResolvedValue({
      webhookUrl: 'https://app.example.com/api/circle/webhook',
      webhookSecret: 'rotated-secret-xyz',
    })

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('inbound-secret-abc')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /^rotate secret$/i }))

    // The confirm step says both Workflows need the new secret, and nothing has run yet.
    expect(screen.getByText(/both circle workflows/i)).toBeTruthy()
    expect(rotateCircleSecretAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /yes, rotate/i }))

    await waitFor(() => expect(rotateCircleSecretAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('rotated-secret-xyz')).toBeTruthy())
    expect(screen.queryByText('inbound-secret-abc')).toBeNull()
    expect(screen.getByText(/secret rotated/i)).toBeTruthy()
    // Both Endpoint URLs now carry the new secret, and none carries the old one.
    expect(screen.getByText(/\/api\/circle\/webhook\?kind=post&token=rotated-secret-xyz$/)).toBeTruthy()
    expect(screen.getByText(/\/api\/circle\/webhook\?kind=comment&token=rotated-secret-xyz$/)).toBeTruthy()
    expect(screen.queryByText(/token=inbound-secret-abc/)).toBeNull()
    expect(routerRefresh).toHaveBeenCalled()
  })

  it('URL-encodes the secret in both Endpoint URLs and still shows the raw secret on its own', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow({ bot_secret: 'a b+c/d=e&f' })]))
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('a b+c/d=e&f')).toBeTruthy())
    const encoded = encodeURIComponent('a b+c/d=e&f')
    const post = screen.getByText((_, el) => el?.textContent?.endsWith(`?kind=post&token=${encoded}`) === true && el.tagName === 'P')
    const comment = screen.getByText((_, el) => el?.textContent?.endsWith(`?kind=comment&token=${encoded}`) === true && el.tagName === 'P')
    // Parsing the URL back gives the original secret.
    expect(new URL(post.textContent!).searchParams.get('token')).toBe('a b+c/d=e&f')
    expect(new URL(comment.textContent!).searchParams.get('kind')).toBe('comment')
  })

  it('cancelling the rotate confirm keeps the current secret and calls nothing', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('inbound-secret-abc')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /^rotate secret$/i }))
    await user.click(screen.getByRole('button', { name: /keep current secret/i }))

    expect(screen.queryByText(/both circle workflows/i)).toBeNull()
    expect(rotateCircleSecretAction).not.toHaveBeenCalled()
    expect(screen.getByText('inbound-secret-abc')).toBeTruthy()
  })

  it('a failed rotate shows the error inline and keeps the current secret', async () => {
    mockFetch.mockResolvedValue(integrationsResponse([circleRow()]))
    vi.mocked(rotateCircleSecretAction).mockResolvedValue({ error: 'You do not have permission to do that.' })

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('inbound-secret-abc')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /^rotate secret$/i }))
    await user.click(screen.getByRole('button', { name: /yes, rotate/i }))

    await waitFor(() => expect(screen.getByText('You do not have permission to do that.')).toBeTruthy())
    expect(screen.getByText('inbound-secret-abc')).toBeTruthy()
    expect(screen.queryByText(/secret rotated/i)).toBeNull()
  })

  it('a non-OK /api/integrations response shows an error with Retry instead of loading forever, and Retry recovers', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Internal error' }) })
      .mockResolvedValueOnce(integrationsResponse([circleRow()]))

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText(/couldn.t load circle settings/i)).toBeTruthy())
    expect(screen.queryByText('Loading…')).toBeNull()

    await user.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    expect(screen.queryByText(/couldn.t load circle settings/i)).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('a fetch that throws (network failure) also shows the error with Retry', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(integrationsResponse([]))

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText(/couldn.t load circle settings/i)).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
  })

  it('has no escalation user field in the summary or the edit form, and does not submit one', async () => {
    mockFetch
      .mockResolvedValueOnce(integrationsResponse([circleRow({ escalation_role_id: 'old-mod' })]))
      .mockResolvedValueOnce(integrationsResponse([circleRow()]))
    vi.mocked(saveCircleIntegrationAction).mockResolvedValue({})

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByText('https://community.acme.com')).toBeTruthy())
    expect(screen.queryByText(/escalation/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: /edit spaces/i }))
    expect(screen.queryByText(/escalation/i)).toBeNull()
    expect(document.querySelector('input[name="escalationUser"]')).toBeNull()
    // The confidence threshold stays.
    expect(document.querySelector('input[name="confidenceThreshold"]')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^update$/i }))
    await waitFor(() => expect(saveCircleIntegrationAction).toHaveBeenCalled())
    const fd = vi.mocked(saveCircleIntegrationAction).mock.calls[0][1] as FormData
    expect(fd.has('escalationUser')).toBe(false)
  })

  it.each([
    ['a validation error', 'Circle community URL is required'],
    ['a plan gate error', 'This integration requires the Pro plan or above — upgrade in Billing to connect it.'],
  ])('a failed save (%s) shows the error inline and stays on the form', async (_label, message) => {
    mockFetch.mockResolvedValue(integrationsResponse([]))
    vi.mocked(saveCircleIntegrationAction).mockResolvedValue({ error: message })

    const user = userEvent.setup()
    render(<CircleIntegrationCard />)

    await waitFor(() => expect(screen.getByPlaceholderText('https://community.example.com')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy())
    expect(screen.getByPlaceholderText('https://community.example.com')).toBeTruthy()
    expect(routerRefresh).not.toHaveBeenCalled()
    // Only the mount fetch ran; a failed save does not reload.
    expect(mockFetch).toHaveBeenCalledTimes(1)
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
