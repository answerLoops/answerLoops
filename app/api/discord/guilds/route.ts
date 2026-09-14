import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'

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

async function fetchGuildChannels(guildId: string, token: string): Promise<{ id: string; name: string }[]> {
  if (MOCK_EXTERNALS) {
    return guildId === MOCK_GUILD.id
      ? MOCK_CHANNELS.map(({ id, name }) => ({ id, name }))
      : []
  }
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers })
  if (!res.ok) return []
  const channels = await res.json() as DiscordChannel[]
  return channels
    .filter((c) => TEXT_CHANNEL_TYPES.has(c.type) && c.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name }))
}

// GET /api/discord/guilds?guild_id=... — fetch channels for a connected guild
// using the platform bot token (no user-supplied token needed)
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const guildId = req.nextUrl.searchParams.get('guild_id')
  if (!guildId) return Response.json({ error: 'guild_id required' }, { status: 400 })

  const token = process.env.DISCORD_TOKEN
  if (!token) return Response.json({ error: 'Platform bot token not configured' }, { status: 503 })

  const channels = await fetchGuildChannels(guildId, token)
  return Response.json({ guildId, channels })
}

// POST /api/discord/guilds — legacy: fetch all guilds using a user-supplied bot token
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { token?: string }
  const token = body.token?.trim()
  if (!token) return Response.json({ error: 'Bot token required' }, { status: 400 })

  let guilds: DiscordGuild[]
  if (MOCK_EXTERNALS) {
    guilds = [MOCK_GUILD]
  } else {
    const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
    const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers })
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
}
