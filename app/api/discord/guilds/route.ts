import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getDiscordGuildByGuildId } from '@/lib/db/queries/discord-guilds'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/discord/guilds'

interface DiscordChannel {
  id: string
  name: string
  type: number
}

interface DiscordGuild {
  id: string
  name: string
}

export interface GuildWithChannels {
  id: string
  name: string
  channels: { id: string; name: string }[]
}

// Discord channel types that can receive messages
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15])

// Deterministic stand-in for the real Discord API, e2e-only. Both the guild
// list and the channel list below are server-to-server fetches issued from
// this route handler, in the Next.js server process — not requests the
// browser ever sees. That means a Playwright-side `page.route()` intercept
// can never reach them (different process, different network stack); the
// mock has to live here instead.
const MOCK_GUILD: DiscordGuild = { id: 'guild-1', name: 'Test Server' }
const MOCK_CHANNELS: DiscordChannel[] = [
  { id: 'ch-general', name: 'general', type: 0 },
  { id: 'ch-support', name: 'support', type: 0 },
]

class DiscordChannelsUnavailableError extends Error {}

// `strict` makes a Discord refusal an error instead of an empty list. The
// single-server lookup uses it so the page can tell "this server has no text
// channels" apart from "answerLoops cannot see this server's channels".
async function fetchGuildChannels(guildId: string, token: string, strict = false): Promise<{ id: string; name: string }[]> {
  if (MOCK_EXTERNALS) {
    return guildId === MOCK_GUILD.id
      ? MOCK_CHANNELS.map(({ id, name }) => ({ id, name }))
      : []
  }
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) {
    if (strict) throw new DiscordChannelsUnavailableError(`Discord returned ${res.status}`)
    return []
  }
  const channels = await res.json() as DiscordChannel[]
  return channels
    .filter((c) => TEXT_CHANNEL_TYPES.has(c.type) && c.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name }))
}

// GET /api/discord/guilds?guild_id=... — fetch channels for a connected guild
// using the platform bot token (no user-supplied token needed)
export async function GET(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return Response.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })

  const guildId = req.nextUrl.searchParams.get('guild_id')
  if (!guildId) return Response.json({ error: 'guild_id required' }, { status: 400 })

  const token = process.env.DISCORD_TOKEN
  if (!token) return Response.json({ error: 'Platform bot token not configured' }, { status: 503 })

  try {
    // Only guilds this org has connected may be queried with the platform token.
    const guild = await getDiscordGuildByGuildId(guildId)
    if (!guild || guild.org_id !== access.orgId) {
      return Response.json({ error: 'Guild not found' }, { status: 404 })
    }
    const channels = await fetchGuildChannels(guildId, token, true)
    return Response.json({ guildId, channels })
  } catch (err) {
    if (err instanceof DiscordChannelsUnavailableError) {
      logger.warn('discord channel list unavailable', { module: MOD, guildId, requestId: getRequestId(req), reason: err.message })
      return Response.json({ error: 'Could not load this server\'s channels' }, { status: 502 })
    }
    logger.error('failed to fetch discord guild channels', { module: MOD, guildId, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/discord/guilds — legacy: fetch all guilds using a user-supplied bot token
export async function POST(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return Response.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })

  try {
    const body = await req.json() as { token?: string }
    const token = body.token?.trim()
    if (!token) return Response.json({ error: 'Bot token required' }, { status: 400 })

    let guilds: DiscordGuild[]
    if (MOCK_EXTERNALS) {
      guilds = [MOCK_GUILD]
    } else {
      const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
      const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers, signal: AbortSignal.timeout(10_000) })
      if (!guildsRes.ok) {
        if (guildsRes.status === 401) return Response.json({ error: 'Invalid bot token. Check it was copied from the Bot tab, not the OAuth2 tab.' }, { status: 400 })
        return Response.json({ error: 'Discord API error. Try again.' }, { status: 502 })
      }
      guilds = await guildsRes.json() as DiscordGuild[]
    }

    const results: GuildWithChannels[] = await Promise.all(
      guilds.map(async (guild) => {
        const channels = await fetchGuildChannels(guild.id, token)
        return { id: guild.id, name: guild.name, channels }
      })
    )

    return Response.json(results)
  } catch (err) {
    logger.error('failed to fetch discord guilds with a user-supplied token', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
