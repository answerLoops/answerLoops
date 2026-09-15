// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IntegrationsPage from '@/app/(dashboard)/integrations/page'
import { useSearchParams } from 'next/navigation'
import { updateDiscordAutoDeflectAction } from '@/app/actions/integrations'

// DiscordIntegrationCard now lives in components/settings/discord.tsx and
// is directly importable, but this file drives it through the full
// IntegrationsPage, matching the existing deflection-badge and tab-dot
// tests for that page — the whole action surface the page imports still
// needs mocking so the module loads, even though this file only exercises
// Discord's OAuth-guild auto-deflect toggle.
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

// Full mock (no importActual) — mirrors every other test of this page.
// importActual would pull in the real module, which imports next-auth's
// auth() and transitively next/server, which the vitest/node module
// resolution here can't load. The prompt's instruction to preserve "the
// other exports from that module via importActual" doesn't hold for this
// particular module in this repo, since even the existing precedent tests
// (settings-page-deflection-tabs.test.tsx, etc.) fully re-mock it instead.
vi.mock('@/app/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  removeDiscordGuildAction: vi.fn(),
  updateDiscordAutoDeflectAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(),
  deleteSlackIntegrationAction: vi.fn(),
  saveTelegramIntegrationAction: vi.fn(),
  deleteTelegramIntegrationAction: vi.fn(),
  saveEmailIntegrationAction: vi.fn(),
  deleteEmailIntegrationAction: vi.fn(),
  generateGoogleChatConnectCodeAction: vi.fn(),
  saveGoogleChatSettingsAction: vi.fn(),
  deleteGoogleChatIntegrationAction: vi.fn(),
  getCurrentDeploymentMode: vi.fn(async () => 'cloud'),
}))
vi.mock('@/app/actions/api-keys', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}))
vi.mock('@/app/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/app/actions/notion', () => ({ saveNotionConnectionAction: vi.fn(), deleteNotionConnectionAction: vi.fn() }))
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

// A single OAuth-connected guild — legacy `integration.enabled` deliberately
// left at 0 so the legacy manual-connect card (which has its own, separately
// tested toggle) never renders here. This isolates the new org-level toggle
// that's only reachable for OAuth-connected orgs.
const connectedGuild = {
  id: 1,
  guild_id: '999',
  guild_name: 'Test Server',
  channel_ids: ['123'],
  escalation_role_id: null,
  enabled: 1,
}

function integrationRow(autoDeflectEnabled: number) {
  return {
    id: 1,
    platform: 'discord',
    channel_ids: [],
    connected_guild_id: '999',
    escalation_role_id: null,
    confidence_threshold: 0.8,
    auto_deflect_enabled: autoDeflectEnabled,
    enabled: 0,
  }
}

describe('DiscordIntegrationCard — OAuth-connected auto-deflect toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setTab('discord')
  })

  it('does not render the toggle when no OAuth guild is connected', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [],
        '/api/discord/guilds/connected': [],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    expect(screen.queryByText('Automatic Deflections')).toBeNull()
  })

  it('renders the toggle once at least one OAuth guild is connected', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [integrationRow(1)],
        '/api/discord/guilds/connected': [connectedGuild],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByText('Automatic Deflections')).toBeTruthy())
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('reflects integration.auto_deflect_enabled = 1 as checked on mount', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [integrationRow(1)],
        '/api/discord/guilds/connected': [connectedGuild],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy())
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('reflects integration.auto_deflect_enabled = 0 as unchecked on mount', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [integrationRow(0)],
        '/api/discord/guilds/connected': [connectedGuild],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy())
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('flipping ON shows the confirm modal first and does not call the action until confirmed', async () => {
    const user = userEvent.setup()
    vi.mocked(updateDiscordAutoDeflectAction).mockResolvedValue(null)
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [integrationRow(0)],
        '/api/discord/guilds/connected': [connectedGuild],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy())
    await user.click(screen.getByRole('checkbox'))

    // Confirm modal appears; action has not been called yet.
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Turn on Automatic Deflections for Discord?')).toBeTruthy()
    expect(updateDiscordAutoDeflectAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Turn on' }))

    await waitFor(() => expect(updateDiscordAutoDeflectAction).toHaveBeenCalledWith(true))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('canceling the confirm modal leaves the toggle off and never calls the action', async () => {
    const user = userEvent.setup()
    vi.mocked(updateDiscordAutoDeflectAction).mockResolvedValue(null)
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [integrationRow(0)],
        '/api/discord/guilds/connected': [connectedGuild],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy())
    await user.click(screen.getByRole('checkbox'))
    expect(await screen.findByRole('dialog')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(updateDiscordAutoDeflectAction).not.toHaveBeenCalled()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('flipping OFF calls the action immediately with false, no confirm modal', async () => {
    const user = userEvent.setup()
    vi.mocked(updateDiscordAutoDeflectAction).mockResolvedValue(null)
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [integrationRow(1)],
        '/api/discord/guilds/connected': [connectedGuild],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    await user.click(screen.getByRole('checkbox'))

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(updateDiscordAutoDeflectAction).toHaveBeenCalledWith(false))
  })

  it('on the action returning an error, shows a toast and the toggle does not silently flip to the failed value', async () => {
    const user = userEvent.setup()
    vi.mocked(updateDiscordAutoDeflectAction).mockResolvedValue({ error: 'Failed to update Discord settings' })
    vi.stubGlobal(
      'fetch',
      mockFetchByUrl({
        '/api/integrations': [integrationRow(1)],
        '/api/discord/guilds/connected': [connectedGuild],
      })
    )

    render(<IntegrationsPage />)

    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
    await user.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(updateDiscordAutoDeflectAction).toHaveBeenCalledWith(false))
    expect(await screen.findByText('Failed to update Discord settings')).toBeTruthy()
    // integration state was never reloaded on error, so the checkbox still
    // reflects the last-known-good server value (on), not the failed flip.
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })
})

// Code review finding: updateDiscordAutoDeflectAction called upsertIntegration
// without an `enabled` field, and upsertIntegration always writes `enabled`
// (defaulting true unless explicitly false — not "leave as-is" like most of
// its other fields). Omitting it would silently re-enable a row someone had
// deliberately disabled. Server actions in this file are tested by source
// assertion elsewhere in this repo (no auth+DB mocking convention exists for
// them) — following that same pattern here.
describe('updateDiscordAutoDeflectAction — preserves the existing enabled flag', () => {
  it('passes enabled explicitly, computed from the existing row, not omitted', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/actions/integrations.ts'), 'utf-8')

    const fnIdx = src.indexOf('export async function updateDiscordAutoDeflectAction')
    expect(fnIdx).toBeGreaterThanOrEqual(0)
    const bodyEnd = src.indexOf('\n}', fnIdx)
    const body = src.slice(fnIdx, bodyEnd)

    expect(body).toContain('enabled: existing ? existing.enabled === 1 : true')
  })
})
