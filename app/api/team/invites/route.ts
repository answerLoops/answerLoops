import type { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getPendingInvitations } from '@/lib/db/queries/invitations'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/team/invites'

export async function GET(req: NextRequest) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })

  const orgId = access.orgId
  try {
    const invites = await getPendingInvitations(orgId)
    return Response.json(invites)
  } catch (err) {
    logger.error('failed to fetch pending invitations', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
