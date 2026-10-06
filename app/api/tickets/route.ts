import { requireOrgAccess } from '@/lib/auth/org'
import { getTickets, decodeTicketCursor } from '@/lib/db/queries/tickets'
import type { TicketStatus, Priority, TicketCategory } from '@/types'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/tickets'

export const dynamic = 'force-dynamic'

// Known Issue 128: this route previously called getTickets with no limit —
// an unbounded query over the org's entire ticket history on every call.
// Default and max page size, same spirit as the Agent API's own get_tickets
// cap, but this internal route isn't a public-contract surface so it isn't
// tied to that constant.
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

function clampLimit(value: string | null): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

export async function GET(request: Request) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
  const orgId = access.orgId

  try {
    const url = new URL(request.url)
    const cursor = decodeTicketCursor(url.searchParams.get('cursor') ?? undefined)
    if (cursor === null) return Response.json({ error: 'Invalid cursor' }, { status: 400 })

    const tickets = await getTickets(
      {
        status: url.searchParams.get('status') as TicketStatus | undefined ?? undefined,
        priority: url.searchParams.get('priority') as Priority | undefined ?? undefined,
        category: url.searchParams.get('category') as TicketCategory | undefined ?? undefined,
      },
      orgId,
      clampLimit(url.searchParams.get('limit')),
      cursor
    )
    return Response.json(tickets)
  } catch (err) {
    logger.error('failed to fetch tickets', { module: MOD, requestId: getRequestId(request), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
