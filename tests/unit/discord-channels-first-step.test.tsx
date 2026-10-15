// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSearchParams } from 'next/navigation'
import { DiscordIntegrationCard } from '@/components/settings/discord'
import { getCurrentDeploymentMode, saveDiscordGuildChannelsAction } from '@/lib/actions/integrations'

// After connecting a server, nothing reads its messages until channels are
// chosen. These tests pin that the card says so, puts that step first, and
// does not call an old manual setup "Active" when it cannot receive anything.

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(async () => ({})),
  removeDiscordGuildAction: vi.fn(),
  updateDiscordAutoDeflectAction: vi.fn(),
  getCurrentDeploymentMode: vi.fn(async () => 'cloud'),
}))

const GUILD_ID = '123456789012345678'

function guild(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    guild_id: GUILD_ID,
    guild_name: 'Support Server',
    channel_ids: [],
    escalation_role_id: null,
    enabled: 1,
    ...overrides,
  }
}

function integration(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    platform: 'discord',
    channel_ids: [],
    connected_guild_id: null,
    escalation_role_id: null,
    confidence_threshold: 0.8,
    auto_deflect_enabled: 0,
    enabled: 1,
    bot_token_last4: null,
    has_bot_token: false,
    ...overrides,
  }
}

function mockFetch(opts: {
  integrations?: unknown[]
  guilds?: unknown[]
  channels?: { ok: boolean; body: unknown }
}) {
  return vi.fn((url: string) => {
    if (url.startsWith('/api/integrations')) {
      return Promise.resolve({ ok: true, json: async () => opts.integrations ?? [] })
    }
    if (url.startsWith('/api/discord/guilds/connected')) {
      return Promise.resolve({ ok: true, json: async () => opts.guilds ?? [] })
    }
    if (url.startsWith('/api/discord/guilds')) {
      const c = opts.channels ?? { ok: true, body: { channels: [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'support' }] } }
      return Promise.resolve({ ok: c.ok, json: async () => c.body })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  })
}

async function renderCard() {
  render(<DiscordIntegrationCard />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
}

describe('Discord card — channels are the first step', () => {
  beforeEach(() => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('tab=discord') as unknown as ReturnType<typeof useSearchParams>)
    vi.mocked(getCurrentDeploymentMode).mockResolvedValue('cloud')
    vi.mocked(saveDiscordGuildChannelsAction).mockClear()
  })

  it('warns, shows "Needs channels" and opens the picker for a server with no channels', async () => {
    vi.stubGlobal('fetch', mockFetch({ integrations: [integration()], guilds: [guild()] }))

    await renderCard()

    expect(screen.getByText('Needs channels')).toBeTruthy()
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.getByText(/not reading any messages from this server yet/i)).toBeTruthy()
    // The picker is already open — no "Edit channels" click needed.
    expect(await screen.findByRole('button', { name: 'Save channels' })).toBeTruthy()
    expect(await screen.findByText('#general')).toBeTruthy()
  })

  it('puts the server that needs channels above the connect button', async () => {
    vi.stubGlobal('fetch', mockFetch({ integrations: [integration()], guilds: [guild()] }))

    await renderCard()

    const serverHeading = screen.getByText('Support Server')
    const connectButton = screen.getByRole('button', { name: 'Add answerLoops to Discord' })
    expect(serverHeading.compareDocumentPosition(connectButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('looks like a normal connected card once channels are saved', async () => {
    vi.stubGlobal('fetch', mockFetch({ integrations: [integration()], guilds: [guild({ channel_ids: ['c1'] })] }))

    await renderCard()

    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByText('Needs channels')).toBeNull()
    expect(screen.queryByText(/not reading any messages/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save channels' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit channels' })).toBeTruthy()
    // With nothing needing attention, the connect box keeps its usual place first.
    const connectButton = screen.getByRole('button', { name: 'Add answerLoops to Discord' })
    const serverHeading = screen.getByText('Support Server')
    expect(connectButton.compareDocumentPosition(serverHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('counts how many servers still need channels', async () => {
    vi.stubGlobal('fetch', mockFetch({
      integrations: [integration()],
      guilds: [guild(), guild({ id: 2, guild_id: '223456789012345678', guild_name: 'Second', channel_ids: ['c1'] })],
    }))

    await renderCard()

    expect(screen.getByText('2 servers connected · 1 needs channels')).toBeTruthy()
  })

  it('after cancelling, offers "Choose channels" instead of silently looking finished', async () => {
    vi.stubGlobal('fetch', mockFetch({ integrations: [integration()], guilds: [guild()] }))
    const user = userEvent.setup()

    await renderCard()
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.getByText(/not reading any messages from this server yet/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose channels' })).toBeTruthy()
  })

  it('will not save with no channel chosen', async () => {
    vi.stubGlobal('fetch', mockFetch({ integrations: [integration()], guilds: [guild()] }))
    const user = userEvent.setup()

    await renderCard()
    await user.click(await screen.findByRole('button', { name: 'Save channels' }))

    expect((await screen.findByText(/Choose at least one channel/i)).textContent).toContain('answerLoops')
    expect(saveDiscordGuildChannelsAction).not.toHaveBeenCalled()
  })

  it('saves once a channel is ticked', async () => {
    vi.stubGlobal('fetch', mockFetch({ integrations: [integration()], guilds: [guild()] }))
    const user = userEvent.setup()

    await renderCard()
    await user.click(await screen.findByLabelText('#support'))
    await user.click(screen.getByRole('button', { name: 'Save channels' }))

    await waitFor(() => expect(saveDiscordGuildChannelsAction).toHaveBeenCalledTimes(1))
    const formData = vi.mocked(saveDiscordGuildChannelsAction).mock.calls[0][1] as FormData
    expect(formData.getAll('channelIds')).toEqual(['c2'])
  })

  it('explains when the channel list cannot be loaded instead of showing a bare text box', async () => {
    vi.stubGlobal('fetch', mockFetch({
      integrations: [integration()],
      guilds: [guild()],
      channels: { ok: false, body: { error: "Could not load this server's channels" } },
    }))

    await renderCard()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not load this server')
    expect(screen.getByPlaceholderText('123456789, 987654321')).toBeTruthy()
  })
})

describe('Discord card — an old manual setup', () => {
  beforeEach(() => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('tab=discord') as unknown as ReturnType<typeof useSearchParams>)
  })

  const manual = () => integration({ has_bot_token: true, bot_token_last4: 'abcd', channel_ids: ['1559675537570533467'] })

  it('on the hosted product, says it is not receiving messages and offers to remove it', async () => {
    vi.mocked(getCurrentDeploymentMode).mockResolvedValue('cloud')
    vi.stubGlobal('fetch', mockFetch({ integrations: [manual()], guilds: [] }))

    await renderCard()

    await waitFor(() => expect(screen.getByText('Not receiving')).toBeTruthy())
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('not reading any messages from Discord yet')
    expect(screen.getByRole('button', { name: 'Remove old setup' })).toBeTruthy()
    // Editing channels on a setup that cannot receive anything would mislead.
    expect(screen.queryByRole('button', { name: /Edit channels & deflections/ })).toBeNull()
  })

  it('on a self-hosted deployment, still treats a manual bot token as a working connection', async () => {
    vi.mocked(getCurrentDeploymentMode).mockResolvedValue('self-hosted')
    vi.stubGlobal('fetch', mockFetch({ integrations: [manual()], guilds: [] }))

    await renderCard()

    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy())
    expect(screen.queryByText('Not receiving')).toBeNull()
    expect(screen.getByRole('button', { name: /Edit channels & deflections/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
  })

  it('does not treat the row a one-click connect leaves behind as a manual setup', async () => {
    vi.mocked(getCurrentDeploymentMode).mockResolvedValue('cloud')
    vi.stubGlobal('fetch', mockFetch({ integrations: [integration()], guilds: [] }))

    await renderCard()

    expect(screen.getByText('Not connected')).toBeTruthy()
    expect(screen.getByText('Inactive')).toBeTruthy()
    expect(screen.queryByText('Bot Token')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('labels the old block as unused when a server is connected too', async () => {
    vi.mocked(getCurrentDeploymentMode).mockResolvedValue('cloud')
    vi.stubGlobal('fetch', mockFetch({ integrations: [manual()], guilds: [guild({ channel_ids: ['c1'] })] }))

    await renderCard()

    await waitFor(() => expect(screen.getByText(/Old manual setup — not in use/)).toBeTruthy())
    expect(screen.getByText('Active')).toBeTruthy()
    const block = screen.getByText('Bot Token').closest('div')!.parentElement!
    expect(within(block).getByRole('button', { name: 'Remove old setup' })).toBeTruthy()
  })
})
