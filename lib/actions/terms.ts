'use server'

import { redirect } from 'next/navigation'
import { and, eq, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { getDb } from '@/lib/db/drizzle'
import { memberships, users } from '@/lib/db/schema'
import { beginTrial } from '@/lib/auth/signup'
import { TERMS_VERSION } from '@/lib/legal/terms'
import { safeNextPath } from '@/lib/auth/next-path'
import { logger } from '@/lib/logger'

interface AcceptTermsInput {
  terms: boolean
  marketing: boolean
  callbackUrl?: string | null
}

/**
 * Records the terms acceptance for the signed-in person, starts their free
 * trial, and sends them on.
 *
 * The terms are required here on the server, not just by the disabled button:
 * a request without them records nothing and starts nothing. Acceptance is
 * kept from the first time it was given and never overwritten; the product
 * updates choice is whatever was submitted this time. The trial itself goes
 * through the ledger (lib/billing/trial.ts), so submitting this twice, or from
 * a second account for the same person, cannot start a second one.
 */
export async function acceptTerms(input: AcceptTermsInput): Promise<{ error: string } | void> {
  if (input.terms !== true) return { error: 'Please accept the Terms of Service and Privacy Policy to continue.' }

  const session = await auth()
  const userId = Number(session?.user?.id)
  if (!session?.user || !Number.isInteger(userId) || userId < 1) redirect('/login')

  const db = getDb()
  const now = new Date()
  const marketing = input.marketing === true

  const [user] = await db
    .update(users)
    .set({
      termsAcceptedAt: sql`COALESCE(${users.termsAcceptedAt}, ${now.toISOString()}::timestamptz)`,
      termsVersion: sql`COALESCE(${users.termsVersion}, ${TERMS_VERSION})`,
      marketingOptIn: marketing,
      marketingOptInAt: marketing ? sql`COALESCE(${users.marketingOptInAt}, ${now.toISOString()}::timestamptz)` : null,
    })
    .where(eq(users.id, userId))
    .returning({ email: users.email, name: users.name, providerAccountId: users.providerAccountId })
  if (!user?.email) redirect('/login')

  // The trial belongs to the workspace this person owns.
  const [owned] = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')))
    .orderBy(memberships.createdAt)
    .limit(1)

  if (owned) {
    await beginTrial({
      userId,
      orgId: owned.orgId,
      email: user.email,
      name: user.name,
      providerAccountId: user.providerAccountId,
    })
  } else {
    // An invited teammate with no workspace of their own has no trial to start.
    logger.info('Terms accepted with no owned workspace; no trial started', { module: 'actions/terms', userId })
  }

  redirect(safeNextPath(input.callbackUrl))
}
