'use server'

import crypto from 'crypto'
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { refresh } from 'next/cache'
import { Resend } from 'resend'
import { auth, unstable_update } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { getDb } from '@/lib/db/drizzle'
import { users, orgs, memberships, tickets } from '@/lib/db/schema'
import {
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  revokeInvitation,
} from '@/lib/db/queries/invitations'
import { addMember, isMember } from '@/lib/db/queries/members'

const INVITE_TTL_DAYS = 7

const InviteSchema = z.object({
  email: z.string().email('Valid email required'),
  role: z.enum(['admin', 'member']).default('member'),
})

export async function sendInviteAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string; inviteUrl?: string } | null> {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }
  const orgId = session.orgId ?? DEFAULT_ORG_ID
  const userId = Number(session.user.id)

  const parsed = InviteSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { email, role } = parsed.data

  const db = getDb()

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existingUser && await isMember(existingUser.id, orgId)) {
    return { error: 'This person is already a member of your workspace.' }
  }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  await createInvitation({ orgId, email, role, token, invitedBy: userId, expiresAt })

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const inviteUrl = `${baseUrl}/invite/${token}`

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const [org] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1)
    const [inviter] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    const orgName = org?.name ?? 'a workspace'
    const inviterName = inviter?.name ?? inviter?.email ?? 'Someone'
    const fromAddress = process.env.RESEND_FROM ?? 'invites@yourdomain.com'

    await resend.emails.send({
      from: fromAddress,
      to: email,
      subject: `${inviterName} invited you to ${orgName}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <h2 style="font-size:20px;font-weight:600;color:#111827;margin-bottom:8px">
            You're invited to join ${orgName}
          </h2>
          <p style="color:#6b7280;font-size:14px;margin-bottom:24px">
            ${inviterName} has invited you to join their workspace on answerLoops as a <strong>${role}</strong>.
            This invite expires in ${INVITE_TTL_DAYS} days.
          </p>
          <a href="${inviteUrl}"
             style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none">
            Accept invitation
          </a>
          <p style="color:#9ca3af;font-size:12px;margin-top:24px">
            Or copy this link: ${inviteUrl}
          </p>
        </div>
      `,
    })
  }

  refresh()
  return { inviteUrl }
}

export async function revokeInviteAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  const id = Number(formData.get('id'))
  if (!id) return { error: 'Missing invite ID' }

  await revokeInvitation(id, orgId)
  refresh()
  return null
}

export async function acceptInviteAction(token: string): Promise<void> {
  const session = await auth()
  if (!session?.user) redirect(`/login?callbackUrl=/invite/${token}`)

  const invite = await getInvitationByToken(token)
  if (!invite || invite.accepted_at) {
    redirect(`/invite/${token}?error=invalid`)
  }

  if (invite.expires_at < new Date().toISOString()) {
    redirect(`/invite/${token}?error=expired`)
  }

  // The invite page already blocks this case before showing the Accept
  // button (app/invite/[token]/page.tsx) — this is defense-in-depth against
  // a direct form POST to a stale-cached page. Whoever is signed in when
  // this action runs must be the actual invited email, not just whoever
  // happens to be logged in on this browser: a shared browser can already
  // have a valid session for a completely different account (e.g. the org
  // owner testing the flow), and without this check that account would
  // silently consume someone else's invite under its own identity —
  // confirmed live, this exact scenario.
  if (session.user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    redirect(`/invite/${token}?error=email_mismatch&email=${encodeURIComponent(invite.email)}`)
  }

  const userId = Number(session.user.id)

  // Someone who follows an invite link while already a member of that org
  // (re-clicking an old link, testing the flow as the org's own owner,
  // whatever the reason) has nothing left to join — but the invitation row
  // itself still needs to be consumed here, or it stays in Pending Invites
  // forever with no membership ever created to explain why. Previously this
  // branch redirected straight to /dashboard without touching the
  // invitation at all, silently leaving it stuck pending indefinitely.
  if (await isMember(userId, invite.org_id)) {
    await acceptInvitation(token)
    redirect('/dashboard')
  }

  await addMember(userId, invite.org_id, invite.role)
  await acceptInvitation(token)

  // Clean up the user's empty personal org if it was freshly created (unboarded, no data)
  const currentOrgId = session.orgId ?? DEFAULT_ORG_ID
  if (currentOrgId !== invite.org_id && currentOrgId !== DEFAULT_ORG_ID) {
    const db = getDb()
    const [hasData] = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(tickets)
      .where(eq(tickets.orgId, currentOrgId))
    const [currentOrg] = await db
      .select({ onboardedAt: orgs.onboardedAt })
      .from(orgs)
      .where(eq(orgs.id, currentOrgId))
      .limit(1)

    if (!currentOrg?.onboardedAt && (hasData?.c ?? 0) === 0) {
      await db.delete(memberships).where(and(eq(memberships.userId, userId), eq(memberships.orgId, currentOrgId)))
      await db.delete(orgs).where(eq(orgs.id, currentOrgId))
    }
  }

  await unstable_update({ orgId: invite.org_id })
  redirect('/dashboard')
}

export async function transferOwnershipAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }
  const orgId = session.orgId ?? DEFAULT_ORG_ID
  const currentUserId = Number(session.user.id)

  const targetMembershipId = Number(formData.get('membershipId'))
  const targetUserId = Number(formData.get('userId'))
  if (!targetMembershipId || !targetUserId) return { error: 'Missing target member.' }
  if (targetUserId === currentUserId) return { error: "Can't transfer to yourself." }

  const db = getDb()

  const [currentMembership] = await db
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, currentUserId), eq(memberships.orgId, orgId)))
    .limit(1)
  if (currentMembership?.role !== 'owner') return { error: 'Only owners can transfer ownership.' }

  const [target] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.id, targetMembershipId), eq(memberships.orgId, orgId)))
    .limit(1)
  if (!target) return { error: 'Member not found.' }

  await db.transaction(async (tx) => {
    await tx
      .update(memberships)
      .set({ role: 'member' })
      .where(and(eq(memberships.id, currentMembership.id), eq(memberships.orgId, orgId)))
    await tx
      .update(memberships)
      .set({ role: 'owner' })
      .where(and(eq(memberships.id, targetMembershipId), eq(memberships.orgId, orgId)))
  })

  refresh()
  return null
}

export async function removeMemberAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }
  const orgId = session.orgId ?? DEFAULT_ORG_ID
  const currentUserId = Number(session.user.id)

  const membershipId = Number(formData.get('membershipId'))
  const targetUserId = Number(formData.get('userId'))

  if (targetUserId === currentUserId) return { error: "You can't remove yourself." }

  const db = getDb()
  const [target] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.orgId, orgId)))
    .limit(1)
  if (target?.role === 'owner') return { error: 'Owners cannot be removed.' }

  await db.delete(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.orgId, orgId)))

  refresh()
  return null
}
