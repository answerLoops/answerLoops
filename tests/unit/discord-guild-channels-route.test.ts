import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The channel picker used to get an empty list whenever Discord refused the
// request, which looked identical to a server with no text channels. The
// single-server lookup now reports the refusal so the page can explain it.

const requireOrgAccess = vi.fn()
const getDiscordGuildByGuildId = vi.fn()
const warn = vi.fn()

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: (...a: unknown[]) => requireOrgAccess(...a) }))
vi.mock('@/lib/db/queries/discord-guilds', () => ({
  getDiscordGuildByGuildId: (...a: unknown[]) => getDiscordGuildByGuildId(...a),
}))
vi.mock('@/lib/mock-mode', () => ({ MOCK_EXTERNALS: false }))
vi.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/request-id', () => ({ getRequestId: () => 'req-1' }))

import { GET, POST } from '@/app/api/discord/guilds/route'

const GUILD_ID = '123456789012345678'

function getRequest() {
  return new NextRequest(`http://localhost/api/discord/guilds?guild_id=${GUILD_ID}`)
}

function discordChannels(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('GET /api/discord/guilds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DISCORD_TOKEN = '<bot-token>'
    requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, userId: 1, role: 'owner' })
    getDiscordGuildByGuildId.mockResolvedValue({ org_id: 5, guild_id: GUILD_ID })
  })

  it('returns text channels, sorted, and drops categories and voice channels', async () => {
    vi.stubGlobal('fetch', discordChannels(200, [
      { id: '3', name: 'support', type: 0 },
      { id: '2', name: 'Voice', type: 2 },
      { id: '1', name: 'general', type: 0 },
      { id: '4', name: 'Category', type: 4 },
    ]))

    const res = await GET(getRequest())

    expect(res.status).toBe(200)
    expect((await res.json()).channels).toEqual([
      { id: '1', name: 'general' },
      { id: '3', name: 'support' },
    ])
  })

  it('returns an empty list, not an error, for a server that genuinely has no text channels', async () => {
    vi.stubGlobal('fetch', discordChannels(200, [{ id: '2', name: 'Voice', type: 2 }]))

    const res = await GET(getRequest())

    expect(res.status).toBe(200)
    expect((await res.json()).channels).toEqual([])
  })

  it.each([403, 404, 500])('reports a 502 when Discord answers %i, so the page can say why', async (status) => {
    vi.stubGlobal('fetch', discordChannels(status, { message: 'nope' }))

    const res = await GET(getRequest())

    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('channels')
    expect(warn).toHaveBeenCalledWith(
      'discord channel list unavailable',
      expect.objectContaining({ guildId: GUILD_ID, reason: `Discord returned ${status}` })
    )
  })

  it('still refuses a server that belongs to another org before calling Discord', async () => {
    getDiscordGuildByGuildId.mockResolvedValue({ org_id: 9, guild_id: GUILD_ID })
    const fetchSpy = discordChannels(200, [])
    vi.stubGlobal('fetch', fetchSpy)

    const res = await GET(getRequest())

    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/discord/guilds (manual token lookup)', () => {
  it('keeps returning an empty channel list for a server it cannot read, so one bad server does not break the rest', async () => {
    requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, userId: 1, role: 'owner' })
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/users/@me/guilds')) {
        return new Response(JSON.stringify([{ id: 'a', name: 'Readable' }, { id: 'b', name: 'Locked' }]), { status: 200 })
      }
      if (String(url).includes('/guilds/a/channels')) {
        return new Response(JSON.stringify([{ id: '1', name: 'general', type: 0 }]), { status: 200 })
      }
      return new Response('{}', { status: 403 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(new NextRequest('http://localhost/api/discord/guilds', {
      method: 'POST',
      body: JSON.stringify({ token: '<bot-token>' }),
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'a', name: 'Readable', channels: [{ id: '1', name: 'general' }] },
      { id: 'b', name: 'Locked', channels: [] },
    ])
  })
})
