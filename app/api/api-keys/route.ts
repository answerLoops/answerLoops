import { requireOrgAccess } from '@/lib/auth/org'
import { listApiKeys } from '@/lib/db/queries/api-keys'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MOD = 'api/api-keys'

// Roles allowed to mint/revoke keys — kept in sync with KEY_ADMIN_ROLES in
// app/actions/api-keys.ts, which is the authoritative check. This is only so
// the UI can hide controls a member would be rejected for using.
const KEY_ADMIN_ROLES = ['owner', 'admin']

export async function GET() {
  try {
    // Membership-verified rather than session-trusting: this lists an org's
    // active credentials, so a session whose token lost its orgId must fail
    // closed instead of silently defaulting to org 1.
    const access = await requireOrgAccess()
    if (!access.ok) return new Response('Unauthorized', { status: 401 })

    const keys = await listApiKeys(access.orgId)
    return Response.json({ keys, can_manage: KEY_ADMIN_ROLES.includes(access.role) })
  } catch (err) {
    logger.error('failed to list api keys', { module: MOD, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
