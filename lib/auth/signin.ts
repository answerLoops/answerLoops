import { parseSignInProvider } from './providers'

export interface SignInValidationParams {
  user?: { email?: string | null } | null
  account?: { provider: string; providerAccountId?: string | null } | null
  profile?: { email_verified?: boolean | null; api_error?: boolean } | null
  env?: Record<string, string | undefined>
}

/**
 * Validates OAuth identity before a session is created.
 *
 * Ensures the provider is configured on this deployment and the user's email
 * address is verified by the provider.
 */
export function isAllowedSignIn(params: SignInValidationParams): boolean | string {
  const { user, account, profile, env = process.env } = params
  if (!account) return false
  if (account.providerAccountId !== undefined && !account.providerAccountId?.trim()) return false

  // The provider must be configured on this deployment.
  if (!parseSignInProvider(account.provider, env)) return false

  // Distinguish upstream provider API failure from unverified email.
  // Inspected before user.email check because API failures yield profile with email: null.
  if (profile?.api_error) {
    return '/login?error=GitHubApiError'
  }

  if (!user?.email?.trim()) return false

  // Enforce verified email on every accepted provider.
  if (profile?.email_verified !== true) {
    return '/login?error=EmailNotVerified'
  }

  return true
}
