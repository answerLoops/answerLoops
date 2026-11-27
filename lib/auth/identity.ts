import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { users } from '@/lib/db/schema'

export type AccountIdentityResult =
  | { allowed: true }
  | { allowed: false; redirectUrl: string }

/**
 * Validates that an incoming OAuth sign-in matches an existing identity or can
 * safely provision a new one.
 *
 * Enforces provider-scoped identity:
 * - A GitHub account is identified strictly by (provider: 'github', providerAccountId).
 * - A GitHub sign-in never claims an account created with Google.
 * - A Google sign-in never claims an account created with GitHub.
 * - Legacy Google accounts (where provider or providerAccountId is null) are preserved.
 */
export async function verifyAccountIdentity(params: {
  provider: string
  providerAccountId: string | null | undefined
  email: string | null | undefined
}): Promise<AccountIdentityResult> {
  const { provider, providerAccountId, email } = params

  if (!providerAccountId || !providerAccountId.trim()) {
    return {
      allowed: false,
      redirectUrl: '/login?error=AccessDenied',
    }
  }

  if (!email || !email.trim()) {
    return {
      allowed: false,
      redirectUrl: '/login?error=AccessDenied',
    }
  }

  const normalizedEmail = email.trim().toLowerCase()
  const trimmedAccountId = providerAccountId.trim()
  const db = getDb()

  // 1. Look up by stable provider-scoped account identity.
  const [userByAccount] = await db
    .select({ id: users.id, email: users.email, provider: users.provider, providerAccountId: users.providerAccountId })
    .from(users)
    .where(and(eq(users.provider, provider), eq(users.providerAccountId, trimmedAccountId)))
    .limit(1)

  if (userByAccount) {
    // Returning user whose provider and account ID match.
    // If their primary verified email changed, verify the new email is not claimed by another user.
    if (userByAccount.email && userByAccount.email.toLowerCase() !== normalizedEmail) {
      const [emailCollision] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${normalizedEmail}`, ne(users.id, userByAccount.id)))
        .limit(1)

      if (emailCollision) {
        return {
          allowed: false,
          redirectUrl: '/login?error=OAuthAccountNotLinked',
        }
      }
    }

    return { allowed: true }
  }

  // 2. Account ID did not match. Check if an account already exists with this email.
  const [userByEmail] = await db
    .select({ id: users.id, provider: users.provider, providerAccountId: users.providerAccountId })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1)

  if (userByEmail) {
    // Legacy accounts created before multi-provider support have provider == null; they are Google accounts.
    const existingProvider = userByEmail.provider ?? 'google'

    if (existingProvider !== provider) {
      if (existingProvider === 'google') {
        return {
          allowed: false,
          redirectUrl: '/login?error=GoogleAccountExists',
        }
      }
      if (existingProvider === 'github') {
        return {
          allowed: false,
          redirectUrl: '/login?error=GitHubAccountExists',
        }
      }
      return {
        allowed: false,
        redirectUrl: '/login?error=OAuthAccountNotLinked',
      }
    }

    // Same provider:
    // If provider is Google and legacy account has no recorded providerAccountId (or matches trimmedAccountId), preserve and link.
    if (provider === 'google' && (!userByEmail.providerAccountId || userByEmail.providerAccountId === trimmedAccountId)) {
      return { allowed: true }
    }

    // Same provider with a different providerAccountId — reject to prevent account ID collision.
    return {
      allowed: false,
      redirectUrl: '/login?error=OAuthAccountNotLinked',
    }
  }

  // 3. New user identity.
  return { allowed: true }
}
