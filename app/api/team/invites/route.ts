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
    // Pending invites (and their accept links) are an owner/admin concern.
    if (access.role === 'member') return Response.json([])
    const invites = await getPendingInvitations(orgId)
    return Response.json(
      invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expires_at: i.expires_at, created_at: i.created_at, token: i.token }))
    )
  } catch (err) {
    logger.error('failed to fetch pending invitations', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
