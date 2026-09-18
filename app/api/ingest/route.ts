import { z } from 'zod'
import { getIntegrationByBotSecret } from '@/lib/db/queries/integrations'
import { processCommunityMessage } from '@/lib/ingest/pipeline'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/ingest'

const IngestSchema = z.object({
  message_id: z.string(),
  content: z.string().min(1),
  author_id: z.string(),
  author_name: z.string(),
  guild_id: z.string().optional(),
  channel_id: z.string(),
  thread_id: z.string().optional(),
  // Defaults to 'discord' for backward compatibility — the Discord bot's
  // forwardMessage (bot/handlers.ts) never sent this field, since this
  // route was Discord-only when it was written. Any other in-process
  // caller forwarding over HTTP (the Slack poller, lib/slack/poller.ts)
  // must always send its real platform explicitly.
  platform: z.enum(['discord', 'slack', 'telegram', 'email', 'github', 'mcp']).optional(),
  // Precomputed deep link back to the original message — only the Slack
  // poller sends this today (chat.getPermalink, resolved while the bot
  // token is in hand). See tickets.source_url in lib/db/schema.ts.
  source_url: z.string().optional(),
})

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!bearerSecret) return new Response('Unauthorized', { status: 401 })

  try {
    // Identify org by bot_secret from integrations; fall back to env var for compat.
    let orgId: number
    const integration = await getIntegrationByBotSecret(bearerSecret)
    if (integration) {
      orgId = integration.org_id
    } else if (process.env.BOT_SECRET && bearerSecret === process.env.BOT_SECRET) {
      orgId = DEFAULT_ORG_ID
    } else {
      return new Response('Unauthorized', { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = IngestSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { message_id, content, author_id, author_name, guild_id, channel_id, thread_id, platform, source_url } = parsed.data

    const result = await processCommunityMessage({
      messageId: message_id,
      content,
      authorId: author_id,
      authorName: author_name,
      guildId: guild_id,
      channelId: channel_id,
      threadId: thread_id,
      platform: platform ?? 'discord',
      sourceUrl: source_url,
    }, orgId)

    return Response.json({ ok: true, ...result })
  } catch (err) {
    logger.error('community message ingest failed', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
