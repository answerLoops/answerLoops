import type { NextRequest } from 'next/server'
import { getTicketById, getTicketReplies, getTicketEvents, deleteTicket } from '@/lib/db/queries/tickets'
import { getAssessment } from '@/lib/db/queries/assessments'
import { auth } from '@/auth'
import { getOrgMembers } from '@/lib/db/queries/members'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/tickets/[id]'

// Live data — never serve a cached snapshot.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  const { id } = await ctx.params
  const ticketId = Number(id)

  try {
    const ticket = await getTicketById(ticketId, orgId)
    if (!ticket) return Response.json({ error: 'Not found' }, { status: 404 })

    const [replies, events, assessment] = await Promise.all([
      getTicketReplies(ticketId),
      getTicketEvents(ticketId),
      getAssessment(ticketId),
    ])

    return Response.json({ ticket, replies, events, assessment })
  } catch (err) {
    logger.error('failed to fetch ticket', { module: MOD, requestId: getRequestId(req), orgId, ticketId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  const { id } = await ctx.params
  const ticketId = Number(id)

  try {
    const userId = Number(session.user.id)
    const members = await getOrgMembers(orgId)
    const role = members.find((m) => m.user_id === userId)?.role
    if (role !== 'owner') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const ticket = await getTicketById(ticketId, orgId)
    if (!ticket) return Response.json({ error: 'Not found' }, { status: 404 })

    await deleteTicket(ticketId)
    return new Response(null, { status: 204 })
  } catch (err) {
    logger.error('failed to delete ticket', { module: MOD, requestId: getRequestId(req), orgId, ticketId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
