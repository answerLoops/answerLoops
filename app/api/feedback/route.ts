import { z } from 'zod'
import { saveFeedback, getTicketIdByAnswerMessage } from '@/lib/db/queries/feedback'
import { getIntegrationByBotSecret } from '@/lib/db/queries/integrations'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { getBearerToken, matchesPlatformBotSecret } from '@/lib/http/bearer-auth'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/feedback'

const FeedbackSchema = z.object({
  message_id: z.string().min(1).max(200),
  vote: z.enum(['up', 'down']),
  actor: z.string().min(1).max(200),
})

// Receives 👍/👎 reactions on posted AI answers, forwarded by the Discord bot.
export async function POST(request: Request) {
  // A per-org Discord secret is scoped to that org; the platform-wide
  // BOT_SECRET (unset or empty never matches) maps to the default org.
  const bearer = getBearerToken(request)
  if (!bearer) return new Response('Unauthorized', { status: 401 })
  let orgId: number
  try {
    const integration = await getIntegrationByBotSecret(bearer, 'discord')
    if (integration) {
      orgId = integration.org_id
    } else if (matchesPlatformBotSecret(bearer)) {
      orgId = DEFAULT_ORG_ID
    } else {
      return new Response('Unauthorized', { status: 401 })
    }
  } catch (err) {
    logger.error('discord feedback auth lookup failed', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = FeedbackSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { message_id, vote, actor } = parsed.data

  try {
    // Only AI answer messages map to a ticket; reactions on anything else are ignored.
    const ticketId = await getTicketIdByAnswerMessage(message_id, orgId)
    if (ticketId === null) {
      return Response.json({ ok: true, ignored: true })
    }

    await saveFeedback({ ticketId, source: 'discord', vote, actor })
    return Response.json({ ok: true, ticket_id: ticketId })
  } catch (err) {
    logger.error('discord feedback save failed', { module: MOD, requestId: getRequestId(request), messageId: message_id, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
