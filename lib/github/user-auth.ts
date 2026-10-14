// GitHub App user-to-server verification for the install callback.
//
// When the GitHub App has "Request user authorization (OAuth) during
// installation" enabled, GitHub sends the browser back with both an
// `installation_id` and an OAuth `code`. Exchanging that code gives a token
// for the person who completed the install, and GET /user/installations lists
// the installations that person can access. An installation is only connected
// to an org when it appears in that list.

const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_API = 'https://api.github.com'
const MAX_PAGES = 10

type GithubInstallationError =
  | 'server_misconfigured'
  | 'authorization_required'
  | 'authorization_failed'
  | 'installation_not_accessible'

type GithubInstallationResult = { ok: true } | { ok: false; error: GithubInstallationError }

/** Exchanges the OAuth `code` for the installing user's access token, or null if GitHub rejects it. */
export async function exchangeGithubUserCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const clientId = process.env.GITHUB_APP_CLIENT_ID
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const res = await fetchImpl(GITHUB_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { access_token?: string; error?: string }
  return data.access_token && !data.error ? data.access_token : null
}

/** True when `installationId` is among the installations the token's user can access. */
export async function userCanAccessInstallation(
  userToken: string,
  installationId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchImpl(`${GITHUB_API}/user/installations?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${userToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { installations?: Array<{ id: number }> }
    const installations = data.installations ?? []
    if (installations.some((i) => i.id === installationId)) return true
    if (installations.length < 100) return false
  }
  return false
}

/**
 * Confirms the person completing the install can access `installationId`.
 * Requires GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET and a `code` from
 * the install redirect.
 */
export async function verifyGithubInstallationAccess(args: {
  code: string | null
  installationId: number
  fetchImpl?: typeof fetch
}): Promise<GithubInstallationResult> {
  if (!process.env.GITHUB_APP_CLIENT_ID || !process.env.GITHUB_APP_CLIENT_SECRET) {
    return { ok: false, error: 'server_misconfigured' }
  }
  if (!args.code) return { ok: false, error: 'authorization_required' }

  const doFetch = args.fetchImpl ?? fetch
  const token = await exchangeGithubUserCode(args.code, doFetch)
  if (!token) return { ok: false, error: 'authorization_failed' }

  const allowed = await userCanAccessInstallation(token, args.installationId, doFetch)
  return allowed ? { ok: true } : { ok: false, error: 'installation_not_accessible' }
}
