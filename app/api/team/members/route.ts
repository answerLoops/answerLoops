import type { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { getOrgMembers } from '@/lib/db/queries/members'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/team/members'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = session.orgId ?? DEFAULT_ORG_ID
  try {
    const members = await getOrgMembers(orgId)
    return Response.json(members)
  } catch (err) {
    logger.error('failed to fetch org members', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
