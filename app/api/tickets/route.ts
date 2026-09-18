import { auth } from '@/auth'
import { getTickets } from '@/lib/db/queries/tickets'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import type { TicketStatus, Priority, TicketCategory } from '@/types'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/tickets'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = session.orgId ?? DEFAULT_ORG_ID

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
