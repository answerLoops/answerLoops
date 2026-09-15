// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import IntegrationsPage from '@/app/(dashboard)/integrations/page'
import { useSearchParams } from 'next/navigation'

// IntegrationsPage pulls in a large surface of server actions purely to wire
// up its child cards' forms — none of them run for the default "discord" tab,
// but the module import graph still needs them mocked so the file loads.
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
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
  saveWidgetOriginsAction: vi.fn(),
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

function mockFetchByUrl(responses: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const match = Object.keys(responses).find((key) => url.startsWith(key))
    if (match) return Promise.resolve({ ok: true, json: async () => responses[match] })
    return Promise.resolve({ ok: true, json: async () => [] })
  })
}

describe("IntegrationsPage tab bar deflection dots", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
  })

  it('shows a green dot on a tab whose platform has automatic deflections enabled', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{ platform: 'discord', enabled: 1, team_id: null, auto_deflect_enabled: 1, channel_ids: [] }],
        '/api/github/repos': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const dot = screen.getByTitle('Automatic Deflections: On')
      expect(dot.className).toContain('bg-emerald-500')
    })
  })

  it('shows a red dot on a tab whose platform has automatic deflections disabled', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{ platform: 'slack', enabled: 1, team_id: null, auto_deflect_enabled: 0 }],
        '/api/github/repos': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const dot = screen.getByTitle('Automatic Deflections: Off')
      expect(dot.className).toContain('bg-red-500')
    })
  })

  it('renders no dot for a platform that has not been connected', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [],
        '/api/github/repos': [],
      })
    )

    render(<IntegrationsPage />)

    // Let the fetches resolve and state settle before asserting an absence.
    await waitFor(() => expect(screen.getByText('Discord')).toBeTruthy())
    expect(screen.queryByTitle('Automatic Deflections: On')).toBeNull()
    expect(screen.queryByTitle('Automatic Deflections: Off')).toBeNull()
  })

  it('renders no dot when an integration row exists but is not actually connected (enabled=0)', async () => {
    // Regression: a row can exist (e.g. a Google Chat pairing that was
    // started but never completed) without `enabled === 1`. The dot must
    // reflect actual connection state, not merely "a row exists."
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{ platform: 'google_chat', enabled: 0, team_id: null, auto_deflect_enabled: 0 }],
        '/api/github/repos': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByText('Google Chat')).toBeTruthy())
    expect(screen.queryByTitle('Automatic Deflections: On')).toBeNull()
    expect(screen.queryByTitle('Automatic Deflections: Off')).toBeNull()
  })

  it('maps the google-chat tab id to the google_chat platform field (hyphen vs underscore)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{ platform: 'google_chat', enabled: 1, team_id: 'T123', auto_deflect_enabled: 1 }],
        '/api/github/repos': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const dots = screen.getAllByTitle('Automatic Deflections: On')
      expect(dots).toHaveLength(1)
    })
  })

  it('maps the discourse tab to the discourse platform and shows a green dot when its deflections are on', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{ platform: 'discourse', enabled: 1, team_id: 'https://forum.example.com', auto_deflect_enabled: 1 }],
        '/api/github/repos': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const dots = screen.getAllByTitle('Automatic Deflections: On')
      expect(dots).toHaveLength(1)
    })
  })

  it('renders no dot for a discourse row that has enabled=1 but no team_id (the !!row.team_id guard)', async () => {
    // Regression: same partial-setup case as Google Chat — a discourse row
    // can exist with enabled=1 before a site URL (team_id) is saved. The tab
    // dot must not light up until the integration is actually connected.
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{ platform: 'discourse', enabled: 1, team_id: null, auto_deflect_enabled: 1 }],
        '/api/github/repos': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByText('Discourse')).toBeTruthy())
    expect(screen.queryByTitle('Automatic Deflections: On')).toBeNull()
    expect(screen.queryByTitle('Automatic Deflections: Off')).toBeNull()
  })

  it('shows GitHub as null (no dot) when zero repos are connected, distinct from "connected but off"', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [],
        '/api/github/repos': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    expect(screen.queryByTitle('Automatic Deflections: On')).toBeNull()
    expect(screen.queryByTitle('Automatic Deflections: Off')).toBeNull()
  })

  it('shows GitHub as green when at least one connected repo has deflections enabled', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [],
        '/api/github/repos': [
          { auto_deflect_enabled: 0 },
          { auto_deflect_enabled: 1 },
        ],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const dot = screen.getByTitle('Automatic Deflections: On')
      expect(dot.className).toContain('bg-emerald-500')
    })
  })

  it('shows GitHub as red when repos are connected but none have deflections enabled', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [],
        '/api/github/repos': [{ auto_deflect_enabled: 0 }],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const dot = screen.getByTitle('Automatic Deflections: Off')
      expect(dot.className).toContain('bg-red-500')
    })
  })
})
