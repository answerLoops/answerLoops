import type { GitHubProfile } from 'next-auth/providers/github'

export interface GitHubUserinfoContext {
  tokens: { access_token?: string }
  provider: { userinfo?: { url?: string } }
}

export type GitHubResolvedProfile = GitHubProfile & { email_verified?: boolean }

interface GitHubEmailRecord {
  email: string
  primary: boolean
  verified: boolean
}

function isValidEmailRecord(item: unknown): item is GitHubEmailRecord {
  if (!item || typeof item !== 'object') return false
  const rec = item as Record<string, unknown>
  return (
    typeof rec.email === 'string' &&
    rec.email.trim().length > 0 &&
    typeof rec.primary === 'boolean' &&
    typeof rec.verified === 'boolean'
  )
}

/**
 * Retrieves GitHub profile and enforces verified primary email identity.
 *
 * Auth.js's default GitHub provider only reads the public profile email from /user
 * (which may be unverified or empty) and falls back to /user/emails only when email
 * is null, without checking e.verified.
 *
 * In addition, under answerLoops identity policy, user accounts and trial ledgers
 * are keyed strictly by verified email identity. Signing someone in under an arbitrary
 * secondary email when their primary identity is unverified violates identity guarantees.
 *
 * This helper queries /user/emails, strictly validates each record, and only accepts
 * an explicitly verified primary email identity.
 */
export async function fetchGitHubProfile(
  context: GitHubUserinfoContext,
  customFetch: typeof fetch = fetch,
): Promise<GitHubResolvedProfile | null> {
  const { tokens, provider } = context
  if (!tokens?.access_token) return null

  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    'User-Agent': 'answerLoops',
    Accept: 'application/vnd.github+json',
  }

  const profileRes = await customFetch(provider.userinfo?.url ?? 'https://api.github.com/user', { headers }).catch(
    () => null,
  )
  if (!profileRes?.ok) return null

  const rawProfile = await profileRes.json().catch(() => null)
  if (!rawProfile || typeof rawProfile !== 'object') return null
  const profile = rawProfile as GitHubResolvedProfile

  const emailsRes = await customFetch('https://api.github.com/user/emails', { headers }).catch(() => null)
  if (!emailsRes?.ok) {
    profile.email_verified = false
    return profile
  }

  const rawEmails = await emailsRes.json().catch(() => null)
  if (!Array.isArray(rawEmails)) {
    profile.email_verified = false
    return profile
  }

  const validEmails: GitHubEmailRecord[] = []
  for (const item of rawEmails) {
    if (isValidEmailRecord(item)) {
      validEmails.push({
        email: item.email.trim().toLowerCase(),
        primary: item.primary,
        verified: item.verified,
      })
    }
  }

  // The primary email is the canonical identity on GitHub.
  const primaryEmail = validEmails.find((e) => e.primary)
  if (primaryEmail && primaryEmail.verified) {
    profile.email = primaryEmail.email
    profile.email_verified = true
  } else if (primaryEmail) {
    profile.email = primaryEmail.email
    profile.email_verified = false
  } else {
    // No valid primary email record found
    profile.email = null
    profile.email_verified = false
  }

  return profile
}
