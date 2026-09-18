import { auth } from '@/auth'
import { listDiscordGuilds, parseDiscordGuildChannelIds } from '@/lib/db/queries/discord-guilds'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MOD = 'api/discord/guilds/connected'

// GET /api/discord/guilds/connected — every Discord server this org has
// connected via OAuth. Distinct from GET /api/discord/guilds?guild_id=,
// which fetches a single guild's channel list from the Discord API.
export async function GET() {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const orgId = session.orgId ?? DEFAULT_ORG_ID

  try {
    const rows = await listDiscordGuilds(orgId)

    const safe = rows.map((row) => ({
      ...row,
      channel_ids: parseDiscordGuildChannelIds(row),
    }))

    return Response.json(safe)
  } catch (err) {
    logger.error('failed to list connected discord guilds', { module: MOD, orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
