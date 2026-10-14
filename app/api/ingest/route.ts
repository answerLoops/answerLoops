import { z } from 'zod'
import { getIntegrationByBotSecret } from '@/lib/db/queries/integrations'
import { processCommunityMessage } from '@/lib/ingest/pipeline'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { getBearerToken, matchesPlatformBotSecret } from '@/lib/http/bearer-auth'
import { isIngestRateLimited, MAX_INGEST_CONTENT_CHARS, WEBHOOK_MAX_BODY_BYTES } from '@/lib/ingest/limits'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/ingest'

// Platforms this endpoint forwards for: the Discord bot and the Slack poller.
// Every other channel arrives through its own authenticated webhook route.
const INGEST_PLATFORMS = ['discord', 'slack'] as const

const IngestSchema = z.object({
  message_id: z.string().min(1).max(200),
  content: z.string().min(1).max(MAX_INGEST_CONTENT_CHARS),
  author_id: z.string().min(1).max(200),
  author_name: z.string().max(200),
  guild_id: z.string().max(200).optional(),
  channel_id: z.string().min(1).max(200),
  thread_id: z.string().max(200).optional(),
  // Defaults to 'discord' for backward compatibility — the Discord bot's
  // forwardMessage (bot/handlers.ts) never sent this field, since this
  // route was Discord-only when it was written. The Slack poller
  // (lib/slack/poller.ts) sends 'slack' explicitly.
  platform: z.enum(INGEST_PLATFORMS).optional(),
  // Precomputed deep link back to the original message — only the Slack
  // poller sends this today (chat.getPermalink, resolved while the bot
  // token is in hand). See tickets.source_url in lib/db/schema.ts.
  source_url: z
    .string()
    .max(2048)
    .refine((v) => {
      try {
        const u = new URL(v)
        return u.protocol === 'https:' || u.protocol === 'http:'
      } catch {
        return false
      }
    }, 'source_url must be an http(s) URL')
    .optional(),
})

export async function POST(request: Request) {
  const bearerSecret = getBearerToken(request)
  if (!bearerSecret) return new Response('Unauthorized', { status: 401 })

  try {
    // The credential decides which platform this caller may speak for: a
    // per-org secret is bound to that org's own integration, while the
    // platform-wide BOT_SECRET (unset or empty never matches) maps to the
    // default org and may forward either supported platform.
    let orgId: number
    let allowedPlatform: (typeof INGEST_PLATFORMS)[number] | null
    const integration = await getIntegrationByBotSecret(bearerSecret, [...INGEST_PLATFORMS])
    if (integration) {
      orgId = integration.org_id
      allowedPlatform = integration.platform as (typeof INGEST_PLATFORMS)[number]
    } else if (matchesPlatformBotSecret(bearerSecret)) {
      orgId = DEFAULT_ORG_ID
      allowedPlatform = null
    } else {
      return new Response('Unauthorized', { status: 401 })
    }

    if (await isIngestRateLimited(orgId)) {
      return Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    const raw = await readBodyCapped(request, WEBHOOK_MAX_BODY_BYTES)
    if (raw === null) return Response.json({ error: 'Payload too large' }, { status: 413 })
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = IngestSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { message_id, content, author_id, author_name, guild_id, channel_id, thread_id, platform, source_url } = parsed.data

    const effectivePlatform = platform ?? allowedPlatform ?? 'discord'
    if (allowedPlatform && effectivePlatform !== allowedPlatform) {
      return Response.json({ error: 'Platform does not match this integration' }, { status: 403 })
    }

    const result = await processCommunityMessage({
      messageId: message_id,
      content,
      authorId: author_id,
      authorName: author_name,
      guildId: guild_id,
      channelId: channel_id,
      threadId: thread_id,
      platform: effectivePlatform,
      sourceUrl: source_url,
    }, orgId)

    return Response.json({ ok: true, ...result })
  } catch (err) {
    logger.error('community message ingest failed', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
