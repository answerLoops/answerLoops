import { z } from 'zod'
import { claimStuckTicketForRetry } from '@/lib/db/queries/tickets'
import { runBackgroundEnrichment } from '@/lib/ingest/pipeline'
import { orgHasAIKey } from '@/lib/db/queries/ai-config'
import { reservePlatformKeyTrial } from '@/lib/billing/platform-key-trial'
import { getDeploymentMode } from '@/lib/billing/plans'
import { isPlatformBotRequest } from '@/lib/http/bearer-auth'
import { logger } from '@/lib/logger'
import type { ModelPurpose } from '@/lib/ai/models'

const MOD = 'api/ingest/retry-stuck'

const RetrySchema = z.object({
  ticket_id: z.number(),
  org_id: z.number(),
})

// Called only by the bot process's stuck-ticket sweep (bot/index.ts) — never
// by a webhook or a browser. Authenticated with the platform-wide BOT_SECRET
// rather than a per-integration secret, since a stuck ticket can belong to
// any platform and this is a cross-org maintenance job, not a single
// integration's traffic. See GitHub issue #222.
export async function POST(request: Request) {
  if (!isPlatformBotRequest(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = RetrySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { ticket_id, org_id } = parsed.data

  // Atomic claim — if this returns null, either another process already
  // claimed it or the original after() job actually finished in the tiny
  // window since the sweep's discovery read. Either way, nothing to do.
  //
  // The claim only matches a ticket owned by the named org, so a request
  // naming the wrong org claims nothing and every step below runs with the
  // org that actually owns the ticket.
  const ticket = await claimStuckTicketForRetry(ticket_id, org_id)
  if (!ticket) return Response.json({ ok: true, claimed: false })
  const ticketOrgId = org_id

  let aiPurpose: ModelPurpose = 'production'
  if (getDeploymentMode() !== 'self-hosted' && !(await orgHasAIKey(ticketOrgId))) {
    const grantedTrial = await reservePlatformKeyTrial(ticketOrgId)
    if (grantedTrial) aiPurpose = 'trial'
  }

  logger.warn('retrying stuck pending ticket', { module: MOD, ticketId: ticket_id, orgId: ticketOrgId })

  // Awaited directly, not scheduled via after() — this route only answers
  // the sweep's own request, there's no separate caller waiting on a fast
  // ack the way a real webhook delivery needs.
  await runBackgroundEnrichment(ticket, ticketOrgId, aiPurpose)

  return Response.json({ ok: true, claimed: true })
}
