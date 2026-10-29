import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { memberships, orgs, users } from '@/lib/db/schema'

/**
 * Is this user actually a member of this org?
 *
 * Deliberately lives apart from lib/auth/org.ts: that module imports `auth`
 * from the root auth config, so anything the auth config itself needs has to
 * sit outside it or the import cycles.
 *
 * The membership table is the only source of truth for org access. Nothing
 * derived from a token or a request body counts, because both are ultimately
 * shaped by the caller.
 */
export async function isOrgMember(userId: unknown, orgId: unknown): Promise<boolean> {
  const uid = Number(userId)
  const oid = Number(orgId)
  if (!Number.isInteger(uid) || uid < 1) return false
  if (!Number.isInteger(oid) || oid < 1) return false

  const [row] = await getDb()
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(and(eq(memberships.userId, uid), eq(memberships.orgId, oid)))
    .limit(1)

  return Boolean(row)
}

/**
 * Decides what a session-update request may do to the `orgId` claim.
 *
 * The claim drives org scoping for the entire application, and the update
 * payload it comes from is caller-supplied, so it is only ever adopted for an
 * org the user has a real membership row for. Treat the payload as untrusted
 * input no matter what transport delivered it.
 *
 * Returns the org id to adopt, or null to leave the existing claim untouched.
 * A rejected switch is a no-op rather than an error: refusing to move is the
 * safe outcome, and throwing here would let a bad request break a valid
 * session instead of simply failing to change it.
 */
export async function resolveOrgIdForSessionUpdate(
  currentUserId: unknown,
  requestedOrgId: unknown
): Promise<number | null> {
  if (requestedOrgId === undefined || requestedOrgId === null) return null
  if (!(await isOrgMember(currentUserId, requestedOrgId))) return null
  return Number(requestedOrgId)
}

/**
 * The per-request org gate: is this session still entitled to act as this org,
 * and what state is the org in?
 *
 * Resolved live on every non-public request rather than read from the token,
 * because two of these outcomes are things a JWT cannot know about. A token is
 * issued once and then re-signed with a fresh expiry on every session read, so
 * anything that revokes access after issuance — the org being soft-deleted, or
 * the user's membership being removed — is invisible to the token indefinitely
 * while the person keeps using the app. Deletion was already handled this way;
 * membership was not, which meant removing a member did not actually end their
 * access to the org.
 *
 * Returns a status for the caller to map onto a response, so the routing and
 * redirect decisions stay in the auth config and the data question stays here.
 * Both ids are validated rather than defaulted: this claim decides which
 * tenant's data every downstream query sees, and substituting a fallback org
 * for a session that never named one is precisely the failure this guards.
 */
export type OrgAccess =
  | { status: 'invalid-session' }
  | { status: 'org-missing' }
  | { status: 'not-member' }
  | { status: 'org-deleted' }
  // termsAcceptedAt is read here, with the rest, so the terms gate costs no extra query.
  | { status: 'ok'; onboardedAt: string | null; termsAcceptedAt: Date | null }

export async function resolveOrgAccess(userId: unknown, orgId: unknown): Promise<OrgAccess> {
  const uid = Number(userId)
  const oid = Number(orgId)
  if (!Number.isInteger(uid) || uid < 1) return { status: 'invalid-session' }
  if (!Number.isInteger(oid) || oid < 1) return { status: 'invalid-session' }

  // One round trip: this runs on every non-public request, so the membership
  // question is a join rather than a second query.
  const [row] = await getDb()
    .select({
      onboardedAt: orgs.onboardedAt,
      deletedAt: orgs.deletedAt,
      membershipId: memberships.id,
      termsAcceptedAt: users.termsAcceptedAt,
    })
    .from(orgs)
    .leftJoin(memberships, and(eq(memberships.orgId, orgs.id), eq(memberships.userId, uid)))
    .leftJoin(users, eq(users.id, uid))
    .where(eq(orgs.id, oid))
    .limit(1)

  if (!row) return { status: 'org-missing' }
  // Ahead of the deleted check on purpose: someone who is no longer a member of
  // an org has no claim on it whatever state it is in, including a restore.
  if (row.membershipId === null) return { status: 'not-member' }
  if (row.deletedAt) return { status: 'org-deleted' }
  return { status: 'ok', onboardedAt: row.onboardedAt, termsAcceptedAt: row.termsAcceptedAt ?? null }
}
