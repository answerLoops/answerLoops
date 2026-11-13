/**
 * The auth secret signs and encrypts every sign-in session, so a production
 * deployment must run with a long random one. This validates the configured
 * value without ever returning or logging it.
 */

export const MIN_AUTH_SECRET_LENGTH = 32

// A random 32-byte secret has well over this many distinct characters. The
// floor only rejects values such as a repeated character or a short pattern
// repeated to reach the minimum length.
const MIN_DISTINCT_CHARACTERS = 10

// Values that appear in documentation, examples and test setups. Matched as a
// case-insensitive substring so a placeholder padded to the minimum length is
// still caught.
const PLACEHOLDER_FRAGMENTS = [
  'test-auth-secret',
  'your-auth-secret',
  'your_auth_secret',
  'change-me',
  'change_me',
  'changeme',
  'placeholder',
  'example',
] as const

export type AuthSecretCheck = { ok: true } | { ok: false; reason: string }

export function checkAuthSecret(value: string | undefined | null): AuthSecretCheck {
  const secret = value?.trim() ?? ''
  if (!secret) return { ok: false, reason: 'AUTH_SECRET is not set.' }

  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    return { ok: false, reason: `AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters long.` }
  }

  if (secret.startsWith('<') || secret.endsWith('>')) {
    return { ok: false, reason: 'AUTH_SECRET is still a placeholder.' }
  }

  const lowered = secret.toLowerCase()
  if (PLACEHOLDER_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    return { ok: false, reason: 'AUTH_SECRET is still a placeholder.' }
  }

  if (new Set(secret).size < MIN_DISTINCT_CHARACTERS) {
    return { ok: false, reason: 'AUTH_SECRET must be a random value.' }
  }

  return { ok: true }
}

/**
 * Refuses to let a production server start with an unusable auth secret.
 * Other environments (development, tests) are left alone so local setup stays
 * frictionless.
 */
export function assertAuthSecretForProduction(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.NODE_ENV !== 'production') return

  const result = checkAuthSecret(env.AUTH_SECRET)
  if (result.ok) return

  throw new Error(
    `${result.reason} Set AUTH_SECRET to a random value of at least ${MIN_AUTH_SECRET_LENGTH} characters. ` +
      'Generate one with: openssl rand -hex 32',
  )
}
