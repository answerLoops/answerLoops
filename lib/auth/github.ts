import type { GitHubProfile } from 'next-auth/providers/github'
import { logger } from '@/lib/logger'

export interface GitHubUserinfoContext {
  tokens: { access_token?: string }
  provider: { userinfo?: { url?: string } }
}

export type GitHubResolvedProfile = GitHubProfile & {
  email_verified?: boolean
  api_error?: boolean
}

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
 * Retrieves the GitHub profile and resolves the user's verified primary email.
 *
 * Queries /user/emails to ensure only an explicitly verified primary email
 * address is accepted as the sign-in identity.
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

  const profileUrl = provider.userinfo?.url ?? 'https://api.github.com/user'
  let profileRes: Response | null = null
  try {
    profileRes = await customFetch(profileUrl, { headers })
  } catch (err) {
    logger.error('GitHub user profile request threw network error', {
      module: 'auth/github',
      endpoint: '/user',
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }

  if (!profileRes?.ok) {
    logger.error('GitHub user profile request returned non-OK status', {
      module: 'auth/github',
      endpoint: '/user',
      status: profileRes?.status,
    })
    return null
  }

  let rawProfile: unknown = null
  try {
    rawProfile = await profileRes.json()
  } catch (err) {
    logger.error('GitHub user profile response was malformed JSON', {
      module: 'auth/github',
      endpoint: '/user',
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }

  if (!rawProfile || typeof rawProfile !== 'object') {
    logger.error('GitHub user profile was not an object', {
      module: 'auth/github',
      endpoint: '/user',
    })
    return null
  }

  const profile = rawProfile as GitHubResolvedProfile

  let emailsRes: Response | null = null
  try {
    emailsRes = await customFetch('https://api.github.com/user/emails', { headers })
  } catch (err) {
    logger.error('GitHub user emails request threw network error', {
      module: 'auth/github',
      endpoint: '/user/emails',
      error: err instanceof Error ? err.message : String(err),
    })
    profile.email_verified = false
    profile.api_error = true
    return profile
  }

  if (!emailsRes?.ok) {
    logger.error('GitHub user emails request returned non-OK status', {
      module: 'auth/github',
      endpoint: '/user/emails',
      status: emailsRes?.status,
    })
    profile.email_verified = false
    profile.api_error = true
    return profile
  }

  let rawEmails: unknown = null
  try {
    rawEmails = await emailsRes.json()
  } catch (err) {
    logger.error('GitHub user emails response was malformed JSON', {
      module: 'auth/github',
      endpoint: '/user/emails',
      error: err instanceof Error ? err.message : String(err),
    })
    profile.email_verified = false
    profile.api_error = true
    return profile
  }

  if (!Array.isArray(rawEmails)) {
    logger.error('GitHub user emails response was not an array', {
      module: 'auth/github',
      endpoint: '/user/emails',
    })
    profile.email_verified = false
    profile.api_error = true
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
    profile.email = null
    profile.email_verified = false
  }

  return profile
}
