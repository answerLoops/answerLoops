import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { getDb } from '@/lib/db/drizzle'
import { memberships } from '@/lib/db/schema'

/**
 * Resolves the caller's org **from a real membership row**, not from the
 * session alone, and optionally gates on their role.
 *
 * Two problems this exists to solve:
 *
 * 1. `session.orgId` is never absent — the Auth.js session callback already
 *    substitutes the default workspace id — so a downstream `?? default`
 *    reads as a guard while guaranteeing a silent fall back to org 1 for any
 *    session whose token lost its `orgId` (stale JWT, provisioning edge
 *    case). Requiring a membership row for (userId, orgId) fails that case
 *    closed instead, since a user with no binding to org 1 has no row.
 *
 * 2. Some actions must be owner-only. `memberships.role` already exists and is
 *    enforced for ownership transfer/member removal; anything that mints or
 *    destroys long-lived org credentials belongs in the same class.
 */

type OrgRole = 'owner' | 'admin' | 'member'

type OrgAccess =
  | { ok: true; orgId: number; userId: number; role: OrgRole }
  | { ok: false; error: string }

/**
 * @param allowedRoles Roles permitted to perform the action. Omit to require
 *   membership only, without gating on role.
 */
export async function requireOrgAccess(allowedRoles?: readonly OrgRole[]): Promise<OrgAccess> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Unauthorized' }

  const userId = Number(session.user.id)
  const orgId = session.orgId
  if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(orgId) || orgId < 1) {
    return { ok: false, error: 'Unauthorized' }
  }

  const [membership] = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1)

  if (!membership) return { ok: false, error: 'Unauthorized' }

  const role = membership.role as OrgRole
  if (allowedRoles && !allowedRoles.includes(role)) {
    return { ok: false, error: 'You do not have permission to do that.' }
  }

  return { ok: true, orgId, userId, role }
}
