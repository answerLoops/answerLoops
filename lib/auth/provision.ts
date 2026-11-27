import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { users, memberships, orgs } from '@/lib/db/schema'
import { beginTrial } from '@/lib/auth/signup'
import { DEFAULT_WIDGET_LEAD_CAPTURE_MODE } from '@/lib/widget/lead-capture'

function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as Record<string, unknown>
  if (typeof e.code === 'string') return e.code
  return pgErrorCode(e.cause)
}

export async function provisionUser(
  email: string,
  name: string | null,
  image: string | null,
  provider: string,
  providerAccountId: string | null,
): Promise<{ userId: number; orgId: number }> {
  if (!providerAccountId || !providerAccountId.trim()) {
    throw new Error('providerAccountId is required for user provisioning')
  }
  if (!email || !email.trim()) {
    throw new Error('email is required for user provisioning')
  }

  const db = getDb()
  const signedInAt = new Date()
  const normalizedEmail = email.trim().toLowerCase()
  const trimmedAccountId = providerAccountId.trim()

  // 1. Resolve returning user strictly by provider-scoped account identity.
  const [userByAccount] = await db
    .select({
      id: users.id,
      email: users.email,
      termsAcceptedAt: users.termsAcceptedAt,
      provider: users.provider,
      providerAccountId: users.providerAccountId,
    })
    .from(users)
    .where(and(eq(users.provider, provider), eq(users.providerAccountId, trimmedAccountId)))
    .limit(1)

  let resolvedUser: { id: number; termsAcceptedAt: Date | null } | null = null

  if (userByAccount) {
    // Returning user with matching provider and account ID.
    // If primary verified email changed, verify the new email is not claimed by another user before updating.
    let emailToUpdate: string | undefined = undefined
    if (userByAccount.email && userByAccount.email.toLowerCase() !== normalizedEmail) {
      const [emailCollision] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            sql`lower(${users.email}) = ${normalizedEmail}`,
            ne(users.id, userByAccount.id),
          ),
        )
        .limit(1)
      if (emailCollision) {
        throw new Error('Email belongs to another user account')
      }
      emailToUpdate = normalizedEmail
    }

    await db
      .update(users)
      .set({
        name: name ?? undefined,
        image: image ?? undefined,
        lastLoginAt: signedInAt,
        ...(emailToUpdate ? { email: emailToUpdate } : {}),
      })
      .where(eq(users.id, userByAccount.id))

    resolvedUser = { id: userByAccount.id, termsAcceptedAt: userByAccount.termsAcceptedAt }
  } else {
    // Account ID not matched. Check existing email to prevent cross-provider collisions and preserve legacy accounts.
    const [userByEmail] = await db
      .select({
        id: users.id,
        email: users.email,
        termsAcceptedAt: users.termsAcceptedAt,
        provider: users.provider,
        providerAccountId: users.providerAccountId,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1)

    if (userByEmail) {
      const existingProvider = userByEmail.provider ?? 'google'
      if (existingProvider !== provider) {
        throw new Error(`Email collision: account was created with ${existingProvider}`)
      }

      // Legacy Google user where providerAccountId is null OR already matches trimmedAccountId.
      if (
        provider === 'google' &&
        (!userByEmail.providerAccountId || userByEmail.providerAccountId === trimmedAccountId)
      ) {
        const [updatedUser] = await db
          .update(users)
          .set({
            provider: 'google',
            providerAccountId: trimmedAccountId,
            lastLoginAt: signedInAt,
            name: name ?? undefined,
            image: image ?? undefined,
            email: normalizedEmail,
          })
          .where(
            and(
              eq(users.id, userByEmail.id),
              or(isNull(users.providerAccountId), eq(users.providerAccountId, trimmedAccountId)),
            ),
          )
          .returning({ id: users.id, termsAcceptedAt: users.termsAcceptedAt })

        if (updatedUser) {
          resolvedUser = { id: updatedUser.id, termsAcceptedAt: updatedUser.termsAcceptedAt }
        } else {
          // Concurrent update: revalidate the resulting record.
          const [reloadedUser] = await db
            .select({
              id: users.id,
              provider: users.provider,
              providerAccountId: users.providerAccountId,
              termsAcceptedAt: users.termsAcceptedAt,
            })
            .from(users)
            .where(eq(users.id, userByEmail.id))
            .limit(1)

          if (
            reloadedUser &&
            (reloadedUser.provider ?? 'google') === 'google' &&
            reloadedUser.providerAccountId === trimmedAccountId
          ) {
            resolvedUser = { id: reloadedUser.id, termsAcceptedAt: reloadedUser.termsAcceptedAt }
          } else {
            throw new Error('Account ID mismatch for existing user email')
          }
        }
      } else {
        throw new Error('Account ID mismatch for existing user email')
      }
    } else {
      // Brand new user. Insert row without email-based conflict updates.
      try {
        const [newUser] = await db
          .insert(users)
          .values({
            email: normalizedEmail,
            name,
            image,
            provider,
            providerAccountId: trimmedAccountId,
            lastLoginAt: signedInAt,
          })
          .returning({ id: users.id, termsAcceptedAt: users.termsAcceptedAt })

        resolvedUser = newUser
      } catch (insertError: unknown) {
        const isUniqueError = pgErrorCode(insertError) === '23505'

        if (!isUniqueError) {
          throw insertError
        }

        // 1. Re-resolve strictly by provider-scoped identity (winner of concurrent insert).
        const [winner] = await db
          .select({
            id: users.id,
            email: users.email,
            termsAcceptedAt: users.termsAcceptedAt,
            provider: users.provider,
            providerAccountId: users.providerAccountId,
          })
          .from(users)
          .where(and(eq(users.provider, provider), eq(users.providerAccountId, trimmedAccountId)))
          .limit(1)

        if (winner) {
          // Verify email ownership.
          if (winner.email && winner.email.toLowerCase() !== normalizedEmail) {
            const [emailCollision] = await db
              .select({ id: users.id })
              .from(users)
              .where(
                and(
                  sql`lower(${users.email}) = ${normalizedEmail}`,
                  ne(users.id, winner.id),
                ),
              )
              .limit(1)

            if (emailCollision) {
              throw new Error('Email belongs to another user account', { cause: insertError })
            }

            await db
              .update(users)
              .set({ email: normalizedEmail, lastLoginAt: signedInAt })
              .where(eq(users.id, winner.id))
          }

          resolvedUser = { id: winner.id, termsAcceptedAt: winner.termsAcceptedAt }
        } else {
          // 2. Winner was NOT this provider identity. Check if email was taken by another account.
          const [conflictingUser] = await db
            .select({
              id: users.id,
              provider: users.provider,
              providerAccountId: users.providerAccountId,
            })
            .from(users)
            .where(sql`lower(${users.email}) = ${normalizedEmail}`)
            .limit(1)

          if (conflictingUser) {
            const existingProvider = conflictingUser.provider ?? 'google'
            throw new Error(`Email collision: account was created with ${existingProvider}`, {
              cause: insertError,
            })
          }

          throw insertError
        }
      }
    }
  }

  const user = resolvedUser!

  // 3. Resolve or create workspace in a transaction serialized per user
  return await db.transaction(async (tx) => {
    // Advisory xact lock serializes workspace creation for this user id so concurrent sign-ins
    // cannot race between checking existing membership and creating a workspace.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8455, ${user.id})`)

    const [existing] = await tx
      .select({ orgId: memberships.orgId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1)

    if (existing) {
      if (existing.role === 'owner' && user.termsAcceptedAt) {
        await beginTrial({
          userId: user.id,
          orgId: existing.orgId,
          email: normalizedEmail,
          name,
          providerAccountId: trimmedAccountId,
        })
      }
      return { userId: user.id, orgId: existing.orgId }
    }

    // New user: create a fresh org workspace.
    const [newOrg] = await tx
      .insert(orgs)
      .values({
        name: 'My Workspace',
        slug: `org-${user.id}-${Date.now()}`,
        widgetLeadCaptureMode: DEFAULT_WIDGET_LEAD_CAPTURE_MODE,
      })
      .returning({ id: orgs.id })

    await tx
      .insert(memberships)
      .values({ userId: user.id, orgId: newOrg.id, role: 'owner' })
      .onConflictDoNothing()

    return { userId: user.id, orgId: newOrg.id }
  })
}
