import { z } from 'zod'
import { getIntegrationByBotSecret } from '@/lib/db/queries/integrations'
import { getTicketIdByCsatMessage, saveCsatRating } from '@/lib/db/queries/csat'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { getBearerToken, matchesPlatformBotSecret } from '@/lib/http/bearer-auth'
import { isIngestRateLimited } from '@/lib/ingest/limits'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/ingest/reaction'

const ReactionSchema = z.object({
  message_id: z.string().min(1).max(200),
  emoji: z.string().min(1).max(100),  // raw emoji name from Discord, e.g. "1️⃣" or "one"
  user_id: z.string().max(200),
})

// Discord sends number emojis as unicode; map both unicode and word forms
const EMOJI_TO_RATING: Record<string, number> = {
  '1️⃣': 1, one: 1,
  '2️⃣': 2, two: 2,
  '3️⃣': 3, three: 3,
  '4️⃣': 4, four: 4,
  '5️⃣': 5, five: 5,
}

export async function POST(request: Request) {
  const bearerSecret = getBearerToken(request)
  if (!bearerSecret) return new Response('Unauthorized', { status: 401 })

  try {
    let orgId: number
    const integration = await getIntegrationByBotSecret(bearerSecret, 'discord')
    if (integration) {
      orgId = integration.org_id
    } else if (matchesPlatformBotSecret(bearerSecret)) {
      orgId = DEFAULT_ORG_ID
    } else {
      return new Response('Unauthorized', { status: 401 })
    }

    if (await isIngestRateLimited(orgId)) {
      return Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = ReactionSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })

    const { message_id, emoji } = parsed.data
    const rating = EMOJI_TO_RATING[emoji]
    if (!rating) return Response.json({ ok: true, ignored: true })

    // Scoped to the caller's org: a message id that maps to another org's
    // ticket is treated exactly like an unknown one.
    const ticketId = await getTicketIdByCsatMessage(message_id, orgId)
    if (!ticketId) return Response.json({ ok: true, ignored: true })

    await saveCsatRating({ ticketId, orgId, rating, platform: 'discord' })

    return Response.json({ ok: true, ticket_id: ticketId, rating })
  } catch (err) {
    logger.error('discord csat reaction ingest failed', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
