import { NextRequest } from 'next/server'
import { getIntegrationByBotSecret, parseChannelIds, parseTeamMemberIds, type Integration } from '@/lib/db/queries/integrations'
import { getTicketByThreadId, isPostedByAnswerLoops } from '@/lib/db/queries/tickets'
import { normalizeCircleContent, fetchCircleRecord, circleMessageId, type CircleContent } from '@/lib/circle/client'
import { processCommunityMessage, recordThreadContextMessage } from '@/lib/ingest/pipeline'
import { readBodyCapped } from '@/lib/http/read-body-capped'
import { clampIngestContent, isIngestRateLimited, WEBHOOK_MAX_BODY_BYTES } from '@/lib/ingest/limits'
import { logger } from '@/lib/logger'

const MOD = 'api/circle/webhook'

// Circle automation Workflow "send webhook" payloads are not contractual.
// We look for the trigger record under any of these keys, and the event kind
// under any of these.
interface CircleWebhookBody {
  event?: string
  type?: string
  trigger?: string
  post?: Record<string, unknown>
  comment?: Record<string, unknown>
  record?: Record<string, unknown>
  data?: Record<string, unknown>
}

/** Keys that only ever appear on a comment record, never on a post. */
const COMMENT_ONLY_KEYS = ['post_id', 'postId', 'parent_id', 'parentId', 'parent_post_id']

function looksLikeComment(record: Record<string, unknown>, eventStr: string): boolean {
  if (eventStr.includes('comment')) return true
  if (eventStr.includes('post')) return false
  return COMMENT_ONLY_KEYS.some((key) => key in record)
}

/**
 * Determine which record this payload carries and whether it's a post or a
 * comment. `explicitKind` — set from the `kind` query param on the webhook
 * URL — is authoritative when present: each Circle Workflow trigger (New
 * post / New comment) is 1:1 with one webhook URL, so the customer's setup
 * pins the kind structurally instead of us guessing it from payload shape.
 * Guessing is kept only as a fallback for URLs configured before that param
 * existed, and is inherently unreliable because the payload shape is not
 * contractual (see comment above) — a comment nested without any of the
 * COMMENT_ONLY_KEYS looks identical to a post.
 */
function pickRecord(
  body: CircleWebhookBody,
  explicitKind: 'post' | 'comment' | null
): { raw: Record<string, unknown>; kind: 'post' | 'comment' } | null {
  // body.comment / body.post are unambiguous on their own — no guessing needed.
  if (body.comment) return { raw: body.comment, kind: 'comment' }
  if (body.post) return { raw: body.post, kind: 'post' }
  const generic = body.record ?? body.data
  if (!generic) return null
  const eventStr = `${body.event ?? ''} ${body.type ?? ''} ${body.trigger ?? ''}`.toLowerCase()
  const kind = explicitKind ?? (looksLikeComment(generic, eventStr) ? 'comment' : 'post')
  return { raw: generic, kind }
}

/**
 * The ticket's link back to Circle. A `url` in the payload is used only when it
 * is an https address on the connected community's host; anything else gets
 * the `<community>/posts/<postId>` link built from the saved community URL.
 */
function sourceUrlFor(payloadUrl: string | null, communityUrl: string | null, postId: string): string | null {
  if (!communityUrl) return null
  const fallback = `${communityUrl}/posts/${postId}`
  if (!payloadUrl) return fallback
  try {
    const link = new URL(payloadUrl)
    const community = new URL(communityUrl)
    return link.protocol === 'https:' && link.host === community.host ? link.href : fallback
  } catch {
    return fallback
  }
}

/**
 * Acknowledge a delivery that will not be ingested, and log why so the owner
 * can see it in their own logs. Logs ids and the reason only, never the
 * record's text.
 */
function acknowledgeDropped(
  orgId: number,
  reason: 'no record' | 'no id' | 'too short' | 'no author' | 'outside watched spaces' | 'own reply' | 'team member',
  record?: { kind: 'post' | 'comment'; id?: string }
): Response {
  logger.info('Circle webhook delivery acknowledged without ingesting', {
    module: MOD,
    orgId,
    ...(record && { kind: record.kind, id: record.id }),
    reason,
  })
  return Response.json({ ok: true })
}

/**
 * Whether a comment was written by the member answerLoops posts replies as:
 * the member id Circle reported for an earlier reply, or the "post replies
 * as" email when the payload carries the author's email. That member is often
 * a real person (with no email saved, replies go out as the token's admin),
 * so a comment of theirs that answerLoops didn't post is kept as team context.
 */
function isPostingMember(
  integration: Pick<Integration, 'bot_user_id' | 'bot_username'>,
  content: CircleContent
): boolean {
  if (integration.bot_user_id && content.authorId === integration.bot_user_id) return true
  return !!(
    integration.bot_username &&
    content.authorEmail &&
    content.authorEmail.toLowerCase() === integration.bot_username.toLowerCase()
  )
}

export async function POST(req: NextRequest) {
  // 1. Resolve the org from the per-org secret. The header is the documented,
  //    preferred transport; ?token= only exists for Workflow actions that
  //    can't set custom headers, and is logged (never the secret value
  //    itself) every time it's the one actually used, so an org relying on it
  //    is visible in its own logs rather than silently accepted.
  const headerSecret = req.headers.get('x-answerloops-token')
  const secret = headerSecret ?? req.nextUrl.searchParams.get('token') ?? ''
  if (!secret) {
    logger.warn('Circle webhook without token', { module: MOD })
    return new Response('Unauthorized', { status: 401 })
  }

  const integration = await getIntegrationByBotSecret(secret, 'circle')
  if (!integration || integration.platform !== 'circle' || integration.enabled !== 1) {
    logger.warn('Circle webhook token did not match a connected org', { module: MOD })
    return new Response('Unauthorized', { status: 401 })
  }
  if (!headerSecret) {
    logger.info('Circle webhook authenticated via ?token= query param, not the header', {
      module: MOD,
      orgId: integration.org_id,
    })
  }

  // The `kind` query param pins post vs. comment per-URL — each Circle
  // Workflow trigger (New post / New comment) is configured to post to its
  // own URL, so this is authoritative when present. See pickRecord().
  const kindParam = req.nextUrl.searchParams.get('kind')
  const explicitKind = kindParam === 'post' || kindParam === 'comment' ? kindParam : null

  if (await isIngestRateLimited(integration.org_id)) {
    return new Response('Too Many Requests', { status: 429 })
  }

  const raw = await readBodyCapped(req, WEBHOOK_MAX_BODY_BYTES)
  if (raw === null) return new Response('Payload Too Large', { status: 413 })
  let body: CircleWebhookBody
  try {
    body = JSON.parse(raw) as CircleWebhookBody
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const picked = pickRecord(body, explicitKind)
  if (!picked) return acknowledgeDropped(integration.org_id, 'no record')

  let content: CircleContent | null = normalizeCircleContent(picked.raw, picked.kind)
  if (!content || content.id === '') return acknowledgeDropped(integration.org_id, 'no id', { kind: picked.kind })

  // 2. Enrich a thin payload from the Admin API when the body is missing. A
  //    lookup that can't be done is answered 502 and logged, so the delivery
  //    shows as Failed in the community's Workflow history with the reason
  //    here, instead of being acknowledged as if there were nothing to ingest.
  //    The integration row is already decrypted when it is loaded, so the
  //    stored token is used as is.
  if (!content.body && integration.bot_token) {
    const lookup = await fetchCircleRecord(integration.bot_token, picked.kind, content.id)
    if (lookup.ok) {
      content = normalizeCircleContent(lookup.record, picked.kind) ?? content
    } else if (lookup.reason !== 'off') {
      logger.warn('Circle webhook could not fetch the full record from the Circle API', {
        module: MOD,
        orgId: integration.org_id,
        kind: picked.kind,
        id: content.id,
        reason: lookup.reason,
        ...(lookup.reason === 'status' && { status: lookup.status }),
      })
      return new Response('Could not fetch the full record from Circle', { status: 502 })
    }
  }

  // 3. Filters — all acknowledged with 200 so Circle does not retry.
  const dropped = { kind: picked.kind, id: content.id }
  const messageId = circleMessageId(picked.kind, content.id)

  // Circle sends every new comment through the "Posted a comment" Workflow,
  // answerLoops's replies included. A reply is recognised by the comment id
  // stored when it was posted. answerLoops only ever replies with comments.
  if (picked.kind === 'comment' && (await isPostedByAnswerLoops(messageId, integration.org_id, 'circle'))) {
    return acknowledgeDropped(integration.org_id, 'own reply', dropped)
  }

  // A short comment on a post we already track is part of the conversation;
  // only content that would open a new ticket must be long enough.
  const isTrackedReply = !!content.body && !!(await getTicketByThreadId(content.postId, integration.org_id, 'circle'))
  if (!content.body || (content.body.length < 10 && !isTrackedReply)) return acknowledgeDropped(integration.org_id, 'too short', dropped)
  if (!content.authorId || content.authorId === '0') return acknowledgeDropped(integration.org_id, 'no author', dropped)

  // A team member's comment is kept on its ticket so the conversation reads
  // in full. It never opens a ticket, reopens one, or notifies anyone, and a
  // team member's post is not a support request.
  if (parseTeamMemberIds(integration).includes(content.authorId) || isPostingMember(integration, content)) {
    const kept = picked.kind === 'comment' && await recordThreadContextMessage(
      {
        messageId,
        content: clampIngestContent(content.body),
        authorName: content.authorName,
        threadId: content.postId,
        platform: 'circle',
      },
      integration.org_id
    )
    if (!kept) return acknowledgeDropped(integration.org_id, 'team member', dropped)
    logger.info('Circle team member comment kept as thread context', {
      module: MOD,
      orgId: integration.org_id,
      id: content.id,
    })
    return Response.json({ ok: true })
  }

  // Watched spaces decide which posts open tickets. A comment on a post we
  // already track belongs to that conversation (its post passed this check
  // when the ticket was made), so it is kept even when the comment's payload
  // doesn't say which space it is in.
  const watched = parseChannelIds(integration)
  if (watched.length > 0 && !isTrackedReply && !watched.includes(content.spaceId)) return acknowledgeDropped(integration.org_id, 'outside watched spaces', dropped)

  const communityUrl = integration.team_id ? integration.team_id.replace(/\/+$/, '') : null
  const sourceUrl = sourceUrlFor(content.url, communityUrl, content.postId)

  logger.info('Circle content received', {
    module: MOD,
    orgId: integration.org_id,
    kind: picked.kind,
    id: content.id,
    spaceId: content.spaceId,
  })

  await processCommunityMessage(
    {
      messageId,
      content: clampIngestContent(content.body),
      authorId: content.authorId,
      authorName: content.authorName,
      channelId: content.spaceId || content.postId,
      threadId: content.postId,
      platform: 'circle',
      sourceUrl: sourceUrl ?? undefined,
    },
    integration.org_id
  )

  return Response.json({ ok: true })
}
