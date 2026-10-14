import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { memberships, users } from '../schema'

interface Member {
  membership_id: number
  user_id: number
  org_id: number
  role: string
  joined_at: string
  email: string | null
  name: string | null
  image: string | null
}

export async function getOrgMembers(orgId: number): Promise<Member[]> {
  const rows = await getDb()
    .select({
      membership_id: memberships.id,
      user_id: memberships.userId,
      org_id: memberships.orgId,
      role: memberships.role,
      joined_at: memberships.createdAt,
      email: users.email,
      name: users.name,
      image: users.image,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(memberships.createdAt)
  return rows
}

/**
 * The org's owner, for the one message addressed to a person rather than to a
 * workspace: the welcome email sent when an org first subscribes.
 *
 * The Stripe webhook knows an org id and nothing about people, and the session
 * it carries holds whatever address Stripe collected at checkout, which is not
 * necessarily the account that signed up. The membership table is the
 * authoritative answer to "whose workspace is this".
 *
 * Ordered by join date so the founding owner wins if ownership was later
 * shared — they are the one who started the trial.
 */
export async function getOrgOwner(orgId: number): Promise<{ email: string | null; name: string | null } | null> {
  const [row] = await getDb()
    .select({ email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')))
    .orderBy(memberships.createdAt)
    .limit(1)
  return row ?? null
}

export async function addMember(userId: number, orgId: number, role: string): Promise<void> {
  await getDb()
    .insert(memberships)
    .values({ userId, orgId, role })
    .onConflictDoNothing()
}

export async function isMember(userId: number, orgId: number): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1)
  return !!row
}
