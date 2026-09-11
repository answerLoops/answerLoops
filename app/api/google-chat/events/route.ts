import { verifyGoogleChatRequest } from '@/lib/google-chat/verify'
import {
  getIntegrationByGoogleChatSpace,
  getIntegrationByPairingCode,
  completeGoogleChatPairing,
} from '@/lib/db/queries/integrations'
import { getTicketByThreadId } from '@/lib/db/queries/tickets'
import { processCommunityMessage } from '@/lib/ingest/pipeline'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'

const MOD = 'api/google-chat/events'

interface GoogleChatAttachment {
  contentName?: string
  downloadUri?: string
  thumbnailUri?: string
}

interface GoogleChatMessage {
  name?: string
  text?: string
  sender?: { name?: string; displayName?: string }
  thread?: { name?: string }
  attachment?: GoogleChatAttachment[]
}

interface GoogleChatEvent {
  type?: string
  message?: GoogleChatMessage
  space?: { name?: string }
  user?: { name?: string; displayName?: string }
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  const audience = process.env.GOOGLE_CHAT_ENDPOINT_URL
  if (!MOCK_EXTERNALS) {
    if (!audience) {
      logger.error('GOOGLE_CHAT_ENDPOINT_URL not configured — cannot verify requests', { module: MOD })
      return new Response('Forbidden: endpoint not configured', { status: 403 })
    }
    const valid = await verifyGoogleChatRequest(request.headers.get('authorization'), audience)
    if (!valid) {
      return new Response('Forbidden: invalid token', { status: 403 })
    }
  }

  let event: GoogleChatEvent
  try {
    event = JSON.parse(rawBody) as GoogleChatEvent
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ADDED_TO_SPACE / REMOVED_FROM_SPACE carry no org mapping by themselves —
  // pairing an org to a space happens explicitly via the /connect command
  // below, since Google Chat's unlisted-app install has no OAuth callback
  // to learn the mapping the way Slack's "Add to Slack" flow does.
  if (event.type !== 'MESSAGE') {
    return Response.json({})
  }

  const spaceName = event.space?.name
  const rawText = event.message?.text?.trim() ?? ''
  if (!spaceName) return Response.json({})

  // An attachment-only message (no caption) has no `text` at all — folding
  // each attachment into a `[Attachment: name] — url` line, same format
  // Slack's event handler uses (lib/slack/attachment-lines.ts), keeps that
  // content from being silently dropped and lets the shared pipeline /
  // ticket detail page render it as a real link instead of losing it.
  const attachments = event.message?.attachment ?? []
  const fileLines = attachments
    .map((a) => `[Attachment: ${a.contentName ?? 'file'}]${a.downloadUri || a.thumbnailUri ? ` — ${a.downloadUri ?? a.thumbnailUri}` : ''}`)
    .join('\n')
  const text = [rawText, fileLines].filter(Boolean).join('\n\n')
  if (!text) return Response.json({})

  const connectMatch = text.match(/^\/connect\s+(\S+)$/)
  if (connectMatch) {
    const code = connectMatch[1]
    const pending = await getIntegrationByPairingCode(code)
    if (!pending) {
      return Response.json({ text: "That connect code wasn't recognized — check Settings → Integrations → Google Chat for a fresh one." })
    }
    await completeGoogleChatPairing(pending.org_id, spaceName)
    logger.info('Google Chat space paired', { module: MOD, orgId: pending.org_id, spaceName })
    return Response.json({ text: '✅ This space is now connected. Questions posted here will flow into your answerLoops dashboard.' })
  }

  const integration = await getIntegrationByGoogleChatSpace(spaceName)
  if (!integration) {
    // Unpaired space — no org to route to. Not an error; just not connected yet.
    return Response.json({})
  }

  const messageId = event.message?.name
  if (!messageId) return Response.json({})

  const threadName = event.message?.thread?.name
  const authorId = event.message?.sender?.name ?? event.user?.name ?? 'unknown'
  const authorName = event.message?.sender?.displayName ?? event.user?.displayName ?? authorId

  const isTrackedReply = threadName ? !!(await getTicketByThreadId(threadName, integration.org_id)) : false
  if (!isTrackedReply && !attachments.length && text.length < 10) {
    return Response.json({})
  }

  const result = await processCommunityMessage({
    messageId,
    content: text,
    authorId,
    authorName,
    channelId: spaceName,
    threadId: threadName,
    platform: 'google_chat',
  }, integration.org_id)

  // Google Chat renders the synchronous webhook response as a Message
  // resource, not an opaque result payload — a body without a `text` (or
  // `cardsV2`) field shows the app as "not responding" in the client, even
  // when it's valid non-empty JSON and even when it arrived instantly. The
  // full AI answer still lands later as a separate threaded reply via the
  // REST API (lib/google-chat/send.ts, from the background enrichment job);
  // this is just the immediate acknowledgment that keeps Chat's own client
  // from showing that placeholder in the meantime.
  const ackText = result.appended
    ? 'Got it — logged as a follow-up on the existing ticket.'
    : "Thanks for reaching out — I'm looking into this now."

  return Response.json({
    text: ackText,
    ...(threadName ? { thread: { name: threadName } } : {}),
  })
}
