// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import IntegrationsPage from '@/app/(dashboard)/integrations/page'
import { useSearchParams } from 'next/navigation'

// IntegrationsPage pulls in a large surface of server actions purely to wire
// up its child cards' forms — none of them run on the overview, but the
// module import graph still needs them mocked so the file loads.
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
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
  saveWidgetOriginsAction: vi.fn(),
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

function mockFetchByUrl(responses: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const match = Object.keys(responses).find((key) => url.startsWith(key))
    if (match) return Promise.resolve({ ok: true, json: async () => responses[match] })
    return Promise.resolve({ ok: true, json: async () => [] })
  })
}

function setTab(tab: string | null) {
  const params = new URLSearchParams(tab ? { tab } : {})
  vi.mocked(useSearchParams).mockReturnValue(params as unknown as ReturnType<typeof useSearchParams>)
}

const card = (label: string) => screen.getByRole('heading', { name: label }).closest('li') as HTMLElement

describe('IntegrationsPage overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setTab(null)
    vi.stubGlobal('fetch', mockFetchByUrl({}))
  })

  it('lists every integration with a link to its own tab', () => {
    render(<IntegrationsPage />)
    const expected: Record<string, string> = {
      Discord: 'discord', Slack: 'slack', Telegram: 'telegram', Discourse: 'discourse',
      'Google Chat': 'google-chat', Circle: 'circle', Email: 'email', GitHub: 'github', Notion: 'notion',
    }
    for (const [label, id] of Object.entries(expected)) {
      expect(within(card(label)).getByRole('link', { name: new RegExp(label) })).toHaveAttribute('href', `/integrations?tab=${id}`)
    }
  })

  it('splits channels from knowledge sources', () => {
    render(<IntegrationsPage />)
    const channels = screen.getByRole('region', { name: 'Channels' })
    const sources = screen.getByRole('region', { name: 'Knowledge sources' })
    for (const l of ['Discord', 'Slack', 'Telegram', 'Discourse', 'Google Chat', 'Circle', 'Email']) {
      expect(within(channels).getByRole('heading', { name: l })).toBeTruthy()
    }
    for (const l of ['GitHub', 'Notion']) expect(within(sources).getByRole('heading', { name: l })).toBeTruthy()
  })

  it('tags only Google Chat, Circle and Email as Beta', () => {
    render(<IntegrationsPage />)
    for (const l of ['Google Chat', 'Circle', 'Email']) expect(within(card(l)).getByText('Beta')).toBeTruthy()
    for (const l of ['Discord', 'Slack', 'Telegram', 'Discourse', 'GitHub', 'Notion']) {
      expect(within(card(l)).queryByText('Beta')).toBeNull()
    }
  })

  it('shows Connected with a Manage button for a connected channel', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      '/api/integrations': [{ platform: 'discord', enabled: 1, team_id: null, auto_deflect_enabled: 1 }],
    }))
    render(<IntegrationsPage />)
    const discord = card('Discord')
    expect(await within(discord).findByText('Connected')).toBeTruthy()
    expect(within(discord).queryByText('Manual review')).toBeNull()
    expect(within(discord).getByRole('link', { name: 'Manage Discord' })).toBeTruthy()
    expect(await within(card('Slack')).findByText('Not connected')).toBeTruthy()
    expect(within(card('Slack')).getByRole('link', { name: 'Connect Slack' })).toBeTruthy()
  })

  it('flags a connected channel whose automatic answers are off as manual review', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      '/api/integrations': [{ platform: 'slack', enabled: 1, team_id: null, auto_deflect_enabled: 0 }],
    }))
    render(<IntegrationsPage />)
    expect(await within(card('Slack')).findByText('Manual review')).toBeTruthy()
    expect(within(card('Slack')).getByText('Connected')).toBeTruthy()
  })

  it('maps the google-chat id to the google_chat platform and needs a paired space', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      '/api/integrations': [{ platform: 'google_chat', enabled: 1, team_id: 'spaces/AAA', auto_deflect_enabled: 1 }],
    }))
    render(<IntegrationsPage />)
    expect(await within(card('Google Chat')).findByText('Connected')).toBeTruthy()
  })

  it('does not call a half-finished Google Chat pairing connected', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      '/api/integrations': [{ platform: 'google_chat', enabled: 1, team_id: null, auto_deflect_enabled: 1 }],
    }))
    render(<IntegrationsPage />)
    expect(await within(card('Google Chat')).findByText('Not connected')).toBeTruthy()
  })

  it('shows Circle as connected from its own row', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({
      '/api/integrations': [{ platform: 'circle', enabled: 1, team_id: 'c1', auto_deflect_enabled: 0 }],
    }))
    render(<IntegrationsPage />)
    const circle = card('Circle')
    expect(await within(circle).findByText('Connected')).toBeTruthy()
    expect(within(circle).queryByText('Manual review')).toBeNull()
  })

  it('shows GitHub connected when a repo is added, and manual review when none auto-answer', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({ '/api/github/repos': [{ auto_deflect_enabled: 0 }] }))
    render(<IntegrationsPage />)
    const github = card('GitHub')
    expect(await within(github).findByText('Connected')).toBeTruthy()
    expect(within(github).getByText('Manual review')).toBeTruthy()
  })

  it('shows GitHub without the review tag when a repo auto-answers, and not connected with no repos', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({ '/api/github/repos': [{ auto_deflect_enabled: 1 }] }))
    const { unmount } = render(<IntegrationsPage />)
    expect(await within(card('GitHub')).findByText('Connected')).toBeTruthy()
    expect(within(card('GitHub')).queryByText('Manual review')).toBeNull()
    unmount()

    vi.stubGlobal('fetch', mockFetchByUrl({ '/api/github/repos': [] }))
    render(<IntegrationsPage />)
    expect(await within(card('GitHub')).findByText('Not connected')).toBeTruthy()
  })

  it('shows Notion connected when it has a connection', async () => {
    vi.stubGlobal('fetch', mockFetchByUrl({ '/api/notion': { connection: { id: 1 } } }))
    render(<IntegrationsPage />)
    expect(await within(card('Notion')).findByText('Connected')).toBeTruthy()
  })

  it('falls back to Not connected rather than staying blank when the status request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    render(<IntegrationsPage />)
    expect(await within(card('Discord')).findByText('Not connected')).toBeTruthy()
    expect(await within(card('Notion')).findByText('Not connected')).toBeTruthy()
  })
})

describe('IntegrationsPage detail view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetchByUrl({}))
  })

  it('opens one integration by its tab, with a way back to the overview', async () => {
    setTab('github')
    render(<IntegrationsPage />)
    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /All integrations/ })).toHaveAttribute('href', '/integrations')
    expect(screen.queryByRole('region', { name: 'Channels' })).toBeNull()
  })

  it('still opens a beta integration by its tab', () => {
    setTab('circle')
    render(<IntegrationsPage />)
    expect(screen.getByRole('heading', { name: 'Circle' })).toBeTruthy()
  })

  it('shows the overview for an unknown tab', () => {
    setTab('nope')
    render(<IntegrationsPage />)
    expect(screen.getByRole('region', { name: 'Channels' })).toBeTruthy()
  })
})
