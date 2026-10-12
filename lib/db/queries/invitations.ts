import { eq, and, isNull, gt } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { invitations } from '../schema'

interface Invitation {
  id: number
  org_id: number
  email: string
  role: string
  token: string
  invited_by: number | null
  expires_at: string
  accepted_at: string | null
  created_at: string
}

function toInvitation(row: typeof invitations.$inferSelect): Invitation {
  return {
    id: row.id,
    org_id: row.orgId,
    email: row.email,
    role: row.role,
    token: row.token,
    invited_by: row.invitedBy,
    expires_at: row.expiresAt,
    accepted_at: row.acceptedAt,
    created_at: row.createdAt,
  }
}

export async function createInvitation(input: {
  orgId: number
  email: string
  role: string
  token: string
  invitedBy: number
  expiresAt: string
}): Promise<Invitation> {
  const db = getDb()
  // Replace any existing pending invite for the same email+org
  await db
    .delete(invitations)
    .where(
      and(
        eq(invitations.orgId, input.orgId),
        eq(invitations.email, input.email),
        isNull(invitations.acceptedAt)
      )
    )

  const [row] = await db
    .insert(invitations)
    .values({
      orgId: input.orgId,
      email: input.email,
      role: input.role,
      token: input.token,
      invitedBy: input.invitedBy,
      expiresAt: input.expiresAt,
    })
    .returning()

  return toInvitation(row)
}

export async function getInvitationByToken(token: string): Promise<Invitation | null> {
  const [row] = await getDb()
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1)
  return row ? toInvitation(row) : null
}

export async function getPendingInvitations(orgId: number): Promise<Invitation[]> {
  const now = new Date().toISOString()
  const rows = await getDb()
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.orgId, orgId),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, now)
      )
    )
    .orderBy(sql`${invitations.createdAt} DESC`)
  return rows.map(toInvitation)
}

export async function acceptInvitation(token: string): Promise<void> {
  await getDb()
    .update(invitations)
    .set({ acceptedAt: new Date().toISOString() })
    .where(eq(invitations.token, token))
}

export async function revokeInvitation(id: number, orgId: number): Promise<void> {
  await getDb()
    .delete(invitations)
    .where(and(eq(invitations.id, id), eq(invitations.orgId, orgId)))
}
