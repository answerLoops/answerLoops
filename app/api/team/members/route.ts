import type { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getOrgMembers } from '@/lib/db/queries/members'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/team/members'

export async function GET(req: NextRequest) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })

  const orgId = access.orgId
  try {
    const members = await getOrgMembers(orgId)
    return Response.json(members)
  } catch (err) {
    logger.error('failed to fetch org members', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
