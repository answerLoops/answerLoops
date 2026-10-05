import { requireOrgAccess } from '@/lib/auth/org'
import { getTickets } from '@/lib/db/queries/tickets'
import type { TicketStatus, Priority, TicketCategory } from '@/types'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/tickets'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
  const orgId = access.orgId

  try {
    const url = new URL(request.url)
    const tickets = await getTickets({
      status: url.searchParams.get('status') as TicketStatus | undefined ?? undefined,
      priority: url.searchParams.get('priority') as Priority | undefined ?? undefined,
      category: url.searchParams.get('category') as TicketCategory | undefined ?? undefined,
    }, orgId)
    return Response.json(tickets)
  } catch (err) {
    logger.error('failed to fetch tickets', { module: MOD, requestId: getRequestId(request), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
