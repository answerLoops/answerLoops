/**
 * The sign-in methods this deployment can actually complete.
 *
 * A method is listed only when its credentials are present, so the login page
 * never offers a button that cannot work — which is exactly what a self-hosted
 * install without its own Google credentials used to show. Adding a method
 * means adding one entry here; the page and the sign-in action both read this
 * list rather than naming providers themselves.
 */
export type SignInProviderId = 'google'

export interface SignInProvider {
  id: SignInProviderId
  label: string
}

interface ProviderDefinition extends SignInProvider {
  /** Environment variables that must all be non-empty for the method to work. */
  requiredEnv: readonly string[]
}

const PROVIDERS: readonly ProviderDefinition[] = [
  { id: 'google', label: 'Google', requiredEnv: ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'] },
]

export function configuredSignInProviders(
  env: Record<string, string | undefined> = process.env,
): SignInProvider[] {
  return PROVIDERS.filter((p) => p.requiredEnv.every((name) => !!env[name]?.trim())).map(
    ({ id, label }) => ({ id, label }),
  )
}

/**
 * Narrows an untrusted string to a provider that is configured here.
 *
 * The id arrives from the browser as a form value and ends up deciding which
 * OAuth flow starts, so it is checked against the list rather than passed
 * through.
 */
export function parseSignInProvider(
  value: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): SignInProviderId | null {
  return configuredSignInProviders(env).find((p) => p.id === value)?.id ?? null
}
