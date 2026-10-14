import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildDiscordInviteUrl, canManageGuild, verifyDiscordInstall } from '@/lib/discord/oauth'

const GUILD = '123456789012345678'
const REDIRECT = 'https://app.example.test/api/discord/callback'

const ENV = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_TOKEN'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.DISCORD_CLIENT_ID = '<client-id>'
  process.env.DISCORD_CLIENT_SECRET = '<client-secret>'
  process.env.DISCORD_TOKEN = '<bot-token>'
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function json(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

interface Opts {
  token?: unknown
  tokenOk?: boolean
  userGuilds?: unknown
  userGuildsOk?: boolean
  botGuild?: unknown
  botGuildOk?: boolean
}

function mockFetch(o: Opts = {}) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/oauth2/token')) {
      return json(o.token ?? { access_token: 'user-token', guild: { id: GUILD, name: 'Guild' } }, o.tokenOk ?? true)
    }
    if (u.endsWith('/users/@me/guilds')) {
      return json(o.userGuilds ?? [{ id: GUILD, name: 'Guild', owner: false, permissions: '32' }], o.userGuildsOk ?? true)
    }
    if (u.endsWith(`/guilds/${GUILD}`)) {
      return json(o.botGuild ?? { id: GUILD, name: 'Bot Guild' }, o.botGuildOk ?? true)
    }
    if (u.endsWith('/oauth2/token/revoke')) return json({})
    throw new Error(`unexpected fetch ${u}`)
  })
}

describe('buildDiscordInviteUrl', () => {
  it('requests bot plus identify and guilds scopes with the signed state', () => {
    const url = new URL(buildDiscordInviteUrl({ clientId: 'cid', redirectUri: REDIRECT, state: 'abc.def' }))
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['bot', 'guilds', 'identify'])
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('state')).toBe('abc.def')
  })
})

describe('canManageGuild', () => {
  it('allows the owner, Administrator and Manage Server', () => {
    expect(canManageGuild({ owner: true, permissions: '0' })).toBe(true)
    expect(canManageGuild({ permissions: '8' })).toBe(true)
    expect(canManageGuild({ permissions: '32' })).toBe(true)
    expect(canManageGuild({ permissions: String(BigInt(1) << BigInt(40) | BigInt(32)) })).toBe(true)
  })

  it('rejects other permissions and unparseable values', () => {
    expect(canManageGuild({ permissions: '2048' })).toBe(false)
    expect(canManageGuild({ permissions: '0' })).toBe(false)
    expect(canManageGuild({ permissions: 'nope' })).toBe(false)
    expect(canManageGuild({})).toBe(false)
  })
})

describe('verifyDiscordInstall', () => {
  it('returns the guild from the token response when the user manages it and the bot is in it', async () => {
    const fetchImpl = mockFetch()
    const result = await verifyDiscordInstall({ code: 'c', redirectUri: REDIRECT, fetchImpl })
    expect(result).toEqual({ ok: true, guildId: GUILD, guildName: 'Bot Guild' })
    // the user token is revoked after the checks
    expect(fetchImpl.mock.calls.some(([u]) => String(u).endsWith('/oauth2/token/revoke'))).toBe(true)
  })

  it('uses the user token for the guild list and the bot token for membership', async () => {
    const fetchImpl = mockFetch()
    await verifyDiscordInstall({ code: 'c', redirectUri: REDIRECT, fetchImpl })
    const auth = (suffix: string): string | undefined => {
      const call = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith(suffix))
      const headers = (call?.[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined
      return headers?.Authorization
    }
    expect(auth('/users/@me/guilds')).toBe('Bearer user-token')
    expect(auth(`/guilds/${GUILD}`)).toBe('Bot <bot-token>')
  })

  it('fails when the code exchange is rejected', async () => {
    const fetchImpl = mockFetch({ tokenOk: false })
    expect(await verifyDiscordInstall({ code: 'c', redirectUri: REDIRECT, fetchImpl })).toEqual({
      ok: false,
      error: 'token_exchange_failed',
    })
  })

  it('fails when the token response carries no guild', async () => {
    const fetchImpl = mockFetch({ token: { access_token: 'user-token' } })
    expect(await verifyDiscordInstall({ code: 'c', redirectUri: REDIRECT, fetchImpl })).toEqual({
      ok: false,
      error: 'guild_not_authorized',
    })
  })

  it('fails when the user is not in the authorized guild list', async () => {
    const fetchImpl = mockFetch({ userGuilds: [{ id: '999999999999999999', permissions: '8' }] })
    expect(await verifyDiscordInstall({ code: 'c', redirectUri: REDIRECT, fetchImpl })).toEqual({
      ok: false,
      error: 'not_guild_admin',
    })
  })

  it('fails when the user lacks Manage Server / Administrator in that guild', async () => {
    const fetchImpl = mockFetch({ userGuilds: [{ id: GUILD, owner: false, permissions: '2048' }] })
    expect(await verifyDiscordInstall({ code: 'c', redirectUri: REDIRECT, fetchImpl })).toEqual({
      ok: false,
      error: 'not_guild_admin',
    })
  })

  it('fails when the bot is not a member of the guild', async () => {
    const fetchImpl = mockFetch({ botGuildOk: false })
    expect(await verifyDiscordInstall({ code: 'c', redirectUri: REDIRECT, fetchImpl })).toEqual({
      ok: false,
      error: 'bot_not_in_guild',
    })
  })

  it('reports a misconfigured server when credentials are missing', async () => {
    delete process.env.DISCORD_CLIENT_SECRET
    const fetchImpl = mockFetch()
    expect(await verifyDiscordInstall({ code: 'c', redirectUri: REDIRECT, fetchImpl })).toEqual({
      ok: false,
      error: 'server_misconfigured',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
