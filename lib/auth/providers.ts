import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import type { Provider } from 'next-auth/providers'
import { fetchGitHubProfile } from './github'

/**
 * The sign-in methods this deployment can actually complete.
 *
 * A method is listed only when its credentials are present, so the login page
 * never offers a button that cannot work — which is exactly what a self-hosted
 * install without its own Google credentials used to show. Adding a method
 * means adding one entry here; the page and the sign-in action both read this
 * list rather than naming providers themselves.
 */
export type SignInProviderId = 'google' | 'github'

export interface SignInProvider {
  id: SignInProviderId
  label: string
}

interface ProviderDefinition extends SignInProvider {
  /** Environment variables that must all be non-empty for the method to work. */
  requiredEnv: readonly string[]
}

const PROVIDER_DEFINITIONS = {
  google: { label: 'Google', requiredEnv: ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'] },
  github: { label: 'GitHub', requiredEnv: ['AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET'] },
} as const satisfies Record<SignInProviderId, { label: string; requiredEnv: readonly string[] }>

const PROVIDERS: readonly ProviderDefinition[] = (
  Object.keys(PROVIDER_DEFINITIONS) as SignInProviderId[]
).map((id) => ({
  id,
  label: PROVIDER_DEFINITIONS[id].label,
  requiredEnv: PROVIDER_DEFINITIONS[id].requiredEnv,
}))

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
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): SignInProviderId | null {
  if (typeof value !== 'string') return null
  return configuredSignInProviders(env).find((p) => p.id === value)?.id ?? null
}

export const PROVIDER_FACTORIES: Record<
  SignInProviderId,
  (env: Record<string, string | undefined>) => Provider
> = {
  google: (env) =>
    Google({
      clientId: env.AUTH_GOOGLE_ID?.trim() ?? process.env.AUTH_GOOGLE_ID?.trim(),
      clientSecret: env.AUTH_GOOGLE_SECRET?.trim() ?? process.env.AUTH_GOOGLE_SECRET?.trim(),
    }),
  github: (env) =>
    GitHub({
      clientId: env.AUTH_GITHUB_ID?.trim() ?? process.env.AUTH_GITHUB_ID?.trim(),
      clientSecret: env.AUTH_GITHUB_SECRET?.trim() ?? process.env.AUTH_GITHUB_SECRET?.trim(),
      userinfo: {
        url: 'https://api.github.com/user',
        request: (context: { tokens: { access_token?: string }; provider: { userinfo?: { url?: string } } }) =>
          fetchGitHubProfile(context),
      },
    }),
}

export function getRegisteredProviders(
  env: Record<string, string | undefined> = process.env,
): Provider[] {
  return configuredSignInProviders(env).map((p) => PROVIDER_FACTORIES[p.id](env))
}
