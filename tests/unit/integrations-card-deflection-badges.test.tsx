// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import IntegrationsPage from '@/app/(dashboard)/integrations/page'
import { GoogleChatIntegrationCard } from '@/components/settings/googlechat'
import { useSearchParams } from 'next/navigation'

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

function setTab(tab: string) {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(`tab=${tab}`) as unknown as ReturnType<typeof useSearchParams>)
}

describe('Integration card deflection badges — always visible, no Edit click required', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Discord: shows the badge on the connected summary as soon as data loads', async () => {
    setTab('discord')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{
          id: 1, platform: 'discord', channel_ids: ['123'], connected_guild_id: null,
          escalation_role_id: null, confidence_threshold: 0.8, auto_deflect_enabled: 1, enabled: 1,
        }],
        '/api/discord/guilds/connected': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByText('Automatic Deflections: On')).toBeTruthy())
    // No "Edit" click happened — the badge showed up in the default view.
    expect(screen.queryByRole('button', { name: /edit/i })).toBeTruthy()
  })

  it('Discord: reflects a disabled state as a red "Off" badge', async () => {
    setTab('discord')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{
          id: 1, platform: 'discord', channel_ids: ['123'], connected_guild_id: null,
          escalation_role_id: null, confidence_threshold: 0.8, auto_deflect_enabled: 0, enabled: 1,
        }],
        '/api/discord/guilds/connected': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const badge = screen.getByText('Automatic Deflections: Off')
      expect(badge.className).toContain('bg-red-100')
    })
  })

  it('Slack: shows the badge on the connected summary without entering channel-edit mode', async () => {
    setTab('slack')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{
          id: 2, platform: 'slack', team_id: 'T123', channel_ids: ['C1'],
          escalation_role_id: null, confidence_threshold: 0.8, auto_deflect_enabled: 1, enabled: 1,
        }],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const badge = screen.getByText('Automatic Deflections: On')
      expect(badge.className).toContain('bg-emerald-100')
    })
  })

  it('Telegram: shows the badge on the connected summary', async () => {
    setTab('telegram')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{
          id: 3, platform: 'telegram', channel_ids: ['456'],
          escalation_role_id: null, confidence_threshold: 0.8, auto_deflect_enabled: 0, enabled: 1,
        }],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const badge = screen.getByText('Automatic Deflections: Off')
      expect(badge.className).toContain('bg-red-100')
    })
  })

  it('Discourse: shows the badge on the connected summary without clicking "Edit categories & deflections"', async () => {
    setTab('discourse')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{
          id: 7, platform: 'discourse', team_id: 'https://forum.example.com', bot_username: 'answerloops-bot',
          channel_ids: ['12'], escalation_role_id: null, confidence_threshold: 0.8, auto_deflect_enabled: 0, enabled: 1,
        }],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const badge = screen.getByText('Automatic Deflections: Off')
      expect(badge.className).toContain('bg-red-100')
    })
    expect(screen.getByRole('button', { name: /edit categories/i })).toBeTruthy()
  })

  it('Email: shows the badge on the connected summary', async () => {
    setTab('email')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{
          id: 4, platform: 'email', bot_token: null, channel_ids: [],
          escalation_role_id: null, confidence_threshold: 0.8, auto_deflect_enabled: 1,
          enabled: 1,
        }],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const badge = screen.getByText('Automatic Deflections: On')
      expect(badge.className).toContain('bg-emerald-100')
    })
  })

  it('GitHub: shows the badge in the repo card, with the toggle itself behind an Edit deflections gate', async () => {
    setTab('github')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/github/repos': [{
          id: 5, org_id: 1, installation_id: 1, owner: 'answerloops', repo: 'app',
          is_private: 1, monitored_events: 'both', kb_enabled: 0, kb_last_synced: null,
          kb_chunk_count: 0, auto_deflect_enabled: 1, added_at: new Date().toISOString(),
        }],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const badge = screen.getByText('Automatic Deflections: On')
      expect(badge.className).toContain('bg-emerald-100')
    })
    // GitHub's deflection toggle is edit-gated same as every other platform
    // now — a team member can't flip it live-posting behavior with a stray
    // click. The badge is always visible; the switch itself needs "Edit
    // deflections" clicked first.
    expect(screen.queryByRole('button', { name: /edit deflections/i })).toBeTruthy()
  })

  it('GitHub: reflects a disabled state as a red "Off" badge', async () => {
    setTab('github')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/github/repos': [{
          id: 5, org_id: 1, installation_id: 1, owner: 'answerloops', repo: 'app',
          is_private: 1, monitored_events: 'both', kb_enabled: 0, kb_last_synced: null,
          kb_chunk_count: 0, auto_deflect_enabled: 0, added_at: new Date().toISOString(),
        }],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => {
      const badge = screen.getByText('Automatic Deflections: Off')
      expect(badge.className).toContain('bg-red-100')
    })
  })

  it('Google Chat: shows the badge on the connected summary without clicking "Edit escalation / confidence"', async () => {
    setTab('google-chat')
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [{
          id: 6, platform: 'google_chat', team_id: 'spaces/AAAA', escalation_role_id: null,
          confidence_threshold: 0.8, auto_deflect_enabled: 1, enabled: 1,
        }],
      })
    )

    render(<GoogleChatIntegrationCard />)

    await waitFor(() => {
      const badge = screen.getByText('Automatic Deflections: On')
      expect(badge.className).toContain('bg-emerald-100')
    })
    expect(screen.getByRole('button', { name: /edit escalation/i })).toBeTruthy()
  })
})
