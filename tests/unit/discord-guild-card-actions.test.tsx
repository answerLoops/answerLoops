// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSearchParams } from 'next/navigation'
import { DiscordIntegrationCard } from '@/components/settings/discord'
import {
  deleteDiscordIntegrationAction,
  getCurrentDeploymentMode,
  removeDiscordGuildAction,
  saveDiscordGuildChannelsAction,
} from '@/lib/actions/integrations'

// Behavior of the per-server card and the old manual setup that the
// channels-first-step tests do not reach: what happens right after a connect,
// removing a server, what a save sends, and the manual setup's edit flow.

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({ replace, refresh: vi.fn() }),
}))

vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(async () => ({})),
  deleteDiscordIntegrationAction: vi.fn(async () => ({})),
  saveDiscordGuildChannelsAction: vi.fn(async () => ({})),
  removeDiscordGuildAction: vi.fn(async () => ({})),
  updateDiscordAutoDeflectAction: vi.fn(),
  getCurrentDeploymentMode: vi.fn(async () => 'cloud'),
}))

const GUILD_ID = '123456789012345678'

const guild = (overrides: Record<string, unknown> = {}) => ({
  id: 1, guild_id: GUILD_ID, guild_name: 'Support Server', channel_ids: ['c1'], escalation_role_id: null, enabled: 1, ...overrides,
})

const integration = (overrides: Record<string, unknown> = {}) => ({
  id: 1, platform: 'discord', channel_ids: [], connected_guild_id: null, escalation_role_id: null,
  confidence_threshold: 0.8, auto_deflect_enabled: 0, enabled: 1, bot_token_last4: null, has_bot_token: false, ...overrides,
})

function stubFetch(guilds: unknown[], integrations: unknown[] = [integration()]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const body = url.startsWith('/api/integrations') ? integrations
      : url.startsWith('/api/discord/guilds/connected') ? guilds
      : url.startsWith('/api/discord/guilds') ? { channels: [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'support' }] }
      : []
    return Promise.resolve({ ok: true, json: async () => body })
  }))
}

function setParams(query: string) {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>)
}

async function renderCard() {
  render(<DiscordIntegrationCard />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentDeploymentMode).mockResolvedValue('cloud')
  setParams('tab=discord')
})

describe('right after connecting a server', () => {
  it('opens the picker for that server and confirms the connect', async () => {
    setParams(`tab=discord&discord_connected=1&guild_id=${GUILD_ID}`)
    // A server that already has channels would normally show its summary.
    stubFetch([guild({ channel_ids: ['c1'] })])

    render(<DiscordIntegrationCard />)

    expect(await screen.findByText('Discord server connected! Select channels below.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Save channels' })).toBeTruthy()
    // The connect parameters are cleared so a refresh does not repeat the toast.
    expect(replace).toHaveBeenCalled()
    expect(String(replace.mock.calls[0][0])).not.toContain('discord_connected')
  })

  it('leaves other servers on their summary view', async () => {
    setParams(`tab=discord&discord_connected=1&guild_id=${GUILD_ID}`)
    stubFetch([
      guild(),
      guild({ id: 2, guild_id: '223456789012345678', guild_name: 'Other Server', channel_ids: ['c2'] }),
    ])

    await renderCard()

    await screen.findByRole('button', { name: 'Save channels' })
    expect(screen.getAllByRole('button', { name: 'Save channels' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Edit channels' })).toBeTruthy()
  })
})

describe('a server card', () => {
  it('removes the server it belongs to', async () => {
    stubFetch([guild()])
    const user = userEvent.setup()

    await renderCard()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(removeDiscordGuildAction).toHaveBeenCalledTimes(1))
    const formData = vi.mocked(removeDiscordGuildAction).mock.calls[0][1] as FormData
    expect(formData.get('guildId')).toBe(GUILD_ID)
  })

  it('sends the escalation role together with the chosen channels', async () => {
    stubFetch([guild()])
    const user = userEvent.setup()

    await renderCard()
    await user.click(screen.getByRole('button', { name: 'Edit channels' }))
    await user.click(await screen.findByLabelText('#support'))
    await user.type(screen.getByPlaceholderText(/Discord role ID/), '987654321098765432')
    await user.click(screen.getByRole('button', { name: 'Save channels' }))

    await waitFor(() => expect(saveDiscordGuildChannelsAction).toHaveBeenCalledTimes(1))
    const formData = vi.mocked(saveDiscordGuildChannelsAction).mock.calls[0][1] as FormData
    expect(formData.get('guildId')).toBe(GUILD_ID)
    expect(formData.getAll('channelIds')).toEqual(expect.arrayContaining(['c1', 'c2']))
    expect(formData.get('escalationRoleId')).toBe('987654321098765432')
  })

  it('returns to the summary after a successful save', async () => {
    stubFetch([guild()])
    const user = userEvent.setup()

    await renderCard()
    await user.click(screen.getByRole('button', { name: 'Edit channels' }))
    await user.click(await screen.findByRole('button', { name: 'Save channels' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save channels' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Edit channels' })).toBeTruthy()
  })

  it('shows the error the save action returns and stays in the picker', async () => {
    vi.mocked(saveDiscordGuildChannelsAction).mockResolvedValueOnce({ error: 'Could not save channels' })
    stubFetch([guild()])
    const user = userEvent.setup()

    await renderCard()
    await user.click(screen.getByRole('button', { name: 'Edit channels' }))
    await user.click(await screen.findByRole('button', { name: 'Save channels' }))

    expect(await screen.findByText('Could not save channels')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save channels' })).toBeTruthy()
  })

  it('cancelling the picker keeps the saved channels untouched', async () => {
    stubFetch([guild()])
    const user = userEvent.setup()

    await renderCard()
    await user.click(screen.getByRole('button', { name: 'Edit channels' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(saveDiscordGuildChannelsAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit channels' })).toBeTruthy()
  })
})

describe('an old manual setup on a self-hosted deployment', () => {
  const manual = () => integration({ has_bot_token: true, bot_token_last4: 'abcd', channel_ids: ['111'], escalation_role_id: '222' })

  beforeEach(() => {
    vi.mocked(getCurrentDeploymentMode).mockResolvedValue('self-hosted')
  })

  it('opens its edit form with the saved channels and closes it on cancel', async () => {
    stubFetch([], [manual()])
    const user = userEvent.setup()

    await renderCard()
    await user.click(await screen.findByRole('button', { name: /Edit channels & deflections/ }))

    expect((screen.getByPlaceholderText('123456789, 987654321') as HTMLInputElement).value).toBe('111')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: /Edit channels & deflections/ })).toBeTruthy()
  })

  it('disconnects when asked', async () => {
    stubFetch([], [manual()])
    const user = userEvent.setup()

    await renderCard()
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(deleteDiscordIntegrationAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
  })
})

describe('an old manual setup on the hosted product', () => {
  it('removing it leaves a connected server in place', async () => {
    vi.mocked(getCurrentDeploymentMode).mockResolvedValue('cloud')
    stubFetch([guild()], [integration({ has_bot_token: true, bot_token_last4: 'abcd', channel_ids: ['111'] })])
    const user = userEvent.setup()

    await renderCard()
    await user.click(await screen.findByRole('button', { name: 'Remove old setup' }))

    await waitFor(() => expect(deleteDiscordIntegrationAction).toHaveBeenCalledTimes(1))
    expect(removeDiscordGuildAction).not.toHaveBeenCalled()
    expect(screen.getByText('Support Server')).toBeTruthy()
  })
})
