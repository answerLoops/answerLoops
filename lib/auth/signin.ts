import { parseSignInProvider } from './providers'

export interface SignInValidationParams {
  user?: { email?: string | null } | null
  account?: { provider: string } | null
  profile?: { email_verified?: boolean | null } | null
  env?: Record<string, string | undefined>
}

/**
 * Validates OAuth identity before a session is created.
 *
 * An address the provider has not verified is refused here: the trial is
 * limited to one per person by email identity, so an unverified address would
 * let someone claim a mailbox that is not theirs, or spend a stranger's trial.
 *
 * In addition, the provider must be configured on this deployment — protecting
 * against unauthorized sign-in attempts directly hitting Auth.js endpoints.
 */
export function isAllowedSignIn(params: SignInValidationParams): boolean | string {
  const { user, account, profile, env = process.env } = params
  if (!user?.email || !account) return false

  // The provider must be configured on this deployment.
  if (!parseSignInProvider(account.provider, env)) return false

  // Enforce verified email on all OAuth sign-in methods.
  if (
    (account.provider === 'google' || account.provider === 'github') &&
    profile?.email_verified !== true
  ) {
    return '/login?error=EmailNotVerified'
  }

  return true
}
