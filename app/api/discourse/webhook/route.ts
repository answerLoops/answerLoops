import { NextRequest } from 'next/server'
import { getIntegrationByDiscourseSite, parseChannelIds } from '@/lib/db/queries/integrations'
import { getTicketByThreadId } from '@/lib/db/queries/tickets'
import { verifyDiscourseSignature } from '@/lib/discourse/client'
import { processCommunityMessage } from '@/lib/ingest/pipeline'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { clampIngestContent, isIngestRateLimited, WEBHOOK_MAX_BODY_BYTES } from '@/lib/ingest/limits'
import { logger } from '@/lib/logger'

const MOD = 'api/discourse/webhook'

// Discourse `post` webhook payload (the fields we use).
interface DiscoursePost {
  id: number
  user_id: number
  username: string
  raw?: string
  cooked?: string
  post_number: number
  post_type?: number
  topic_id: number
  topic_slug?: string
  category_id?: number | null
}

interface DiscourseWebhookBody {
  post?: DiscoursePost
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(req: NextRequest) {
  // 1. Resolve the org first — the HMAC key is per-org and Discourse tells us
  //    which instance sent the event.
  const instance = req.headers.get('x-discourse-instance')
  if (!instance) {
    logger.warn('Discourse webhook without X-Discourse-Instance', { module: MOD })
    return new Response('Unauthorized', { status: 401 })
  }

  const integration = await getIntegrationByDiscourseSite(instance)
  if (!integration || integration.platform !== 'discourse' || !integration.bot_secret) {
    logger.warn('Discourse webhook instance did not match any org', { module: MOD, instance })
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Verify the signature against this org's secret. Read the raw body once,
  //    counting bytes as they stream so an oversized body is cut off early.
  const rawBody = await readBodyCapped(req, WEBHOOK_MAX_BODY_BYTES)
  if (rawBody === null) return new Response('Payload Too Large', { status: 413 })
  const signature = req.headers.get('x-discourse-event-signature')
  if (!verifyDiscourseSignature(rawBody, signature, integration.bot_secret)) {
    logger.warn('Discourse webhook signature mismatch', { module: MOD, orgId: integration.org_id })
    return new Response('Unauthorized', { status: 401 })
  }

  if (await isIngestRateLimited(integration.org_id)) {
    return new Response('Too Many Requests', { status: 429 })
  }

  // 3. Setup ping — acknowledge.
  const event = req.headers.get('x-discourse-event')
  if (event === 'ping') return Response.json({ ok: true })

  // 4. We only act on new posts (a new topic's first post fires post_created
  //    too, so this covers both new topics and replies).
  if (event !== 'post_created') return Response.json({ ok: true })

  let body: DiscourseWebhookBody
  try {
    body = JSON.parse(rawBody) as DiscourseWebhookBody
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const post = body.post
  if (!post || typeof post.id !== 'number') return Response.json({ ok: true })

  // 5. Filters — all ignored with a 200 so Discourse does not retry.
  //    Skip the bot's own posts (loop guard), system/staged users, and posts
  //    outside the watched categories.
  if (integration.bot_username && post.username === integration.bot_username) {
    return Response.json({ ok: true })
  }
  if (post.user_id <= 0) return Response.json({ ok: true })
  if (post.post_type != null && post.post_type !== 1) return Response.json({ ok: true })

  const categoryId = post.category_id != null ? String(post.category_id) : ''
  const watched = parseChannelIds(integration)
  if (watched.length > 0 && !watched.includes(categoryId)) {
    return Response.json({ ok: true })
  }

  const content = clampIngestContent((post.raw ?? (post.cooked ? stripHtml(post.cooked) : '')).trim())
  // A short reply ("thanks, that worked") in a topic we already track is part
  // of the conversation; only a post that would open a new ticket must be
  // long enough to be a question.
  const isTrackedReply = !!(await getTicketByThreadId(String(post.topic_id), integration.org_id))
  if (content.length < 10 && !isTrackedReply) return Response.json({ ok: true })

  const siteUrl = integration.team_id ?? instance.replace(/\/+$/, '')
  const slug = post.topic_slug ?? 'topic'
  const sourceUrl = `${siteUrl}/t/${slug}/${post.topic_id}/${post.post_number}`

  logger.info('Discourse post received', {
    module: MOD,
    orgId: integration.org_id,
    topicId: post.topic_id,
    postId: post.id,
    categoryId,
  })

  await processCommunityMessage(
    {
      messageId: `discourse-post-${post.id}`,
      content,
      authorId: String(post.user_id),
      authorName: post.username,
      channelId: categoryId || String(post.topic_id),
      threadId: String(post.topic_id),
      platform: 'discourse',
      sourceUrl,
    },
    integration.org_id
  )

  return Response.json({ ok: true })
}
