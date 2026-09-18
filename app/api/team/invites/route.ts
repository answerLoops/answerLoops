import type { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { getPendingInvitations } from '@/lib/db/queries/invitations'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/team/invites'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = session.orgId ?? DEFAULT_ORG_ID
  try {
    const invites = await getPendingInvitations(orgId)
    return Response.json(invites)
  } catch (err) {
    logger.error('failed to fetch pending invitations', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
