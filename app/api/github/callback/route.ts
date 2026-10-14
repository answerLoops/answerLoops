import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { clearOAuthNonceCookie, oauthNonceCookieName, verifyOAuthCallback, verifyOAuthState } from '@/lib/oauth/state'
import { addRepo, GithubRepoTakenError } from '@/lib/db/queries/github'
import { listInstallationRepos } from '@/lib/github/app'
import { verifyGithubInstallationAccess } from '@/lib/github/user-auth'
import { logger } from '@/lib/logger'

const MOD = 'api/github/callback'

export async function GET(req: NextRequest) {
  const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin
  const { searchParams } = req.nextUrl
  const state = searchParams.get('state')

  // Decode `from` before we know whether the rest of the flow succeeds, so
  // even a failure redirects back to whichever screen started it. The state is
  // fully authenticated again below before anything is connected.
  let from = 'integrations'
  try {
    from = verifyOAuthState(state).from === 'onboarding' ? 'onboarding' : 'integrations'
  } catch {
    // handled again below, where the failure is actually reported
  }

  // The nonce cookie is single use: every outcome below clears it.
  const finish = (url: URL) => clearOAuthNonceCookie(NextResponse.redirect(url), 'github')
  const errUrl = (code: string) =>
    finish(
      from === 'onboarding'
        ? new URL(`/onboarding?github_error=${code}`, baseUrl)
        : new URL(`/integrations?tab=github&github_error=${code}`, baseUrl),
    )

  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) {
    if (access.error === 'Unauthorized') return NextResponse.redirect(new URL('/login', baseUrl))
    return errUrl('forbidden')
  }

  // The installation is bound to the org named in a state this server signed
  // for this user, matched to the nonce cookie set when the flow began.
  // Anything else is rejected; there is no default-org fallback.
  let orgId: number
  try {
    const decoded = verifyOAuthCallback({
      provider: 'github',
      state,
      cookieNonce: req.cookies.get(oauthNonceCookieName('github'))?.value,
      caller: { userId: access.userId, orgId: access.orgId },
    })
    orgId = decoded.orgId
  } catch (err) {
    logger.warn('invalid github callback state', { module: MOD, error: err instanceof Error ? err.message : err })
    return errUrl('invalid_state')
  }

  const installationId = Number(searchParams.get('installation_id'))
  if (!Number.isInteger(installationId) || installationId < 1) {
    return errUrl('missing_installation')
  }

  // Confirm the person completing the install can access this installation.
  const verified = await verifyGithubInstallationAccess({ code: searchParams.get('code'), installationId })
  if (!verified.ok) {
    logger.warn('github installation not verified', { module: MOD, orgId, reason: verified.error })
    return errUrl(verified.error)
  }

  try {
    const repos = await listInstallationRepos(installationId)
    let connected = 0
    const taken: string[] = []
    for (const { owner, repo, isPrivate } of repos) {
      try {
        await addRepo(installationId, owner, repo, isPrivate, orgId)
        connected++
      } catch (err) {
        if (err instanceof GithubRepoTakenError) {
          taken.push(`${owner}/${repo}`)
          continue
        }
        throw err
      }
    }
    logger.info('github installation connected', {
      module: MOD,
      installationId,
      repoCount: connected,
      skippedRepoCount: taken.length,
      orgId,
    })
    if (taken.length > 0 && connected === 0) return errUrl('repo_already_connected')
  } catch (err) {
    const cause = err instanceof Error ? { message: err.message, cause: (err as NodeJS.ErrnoException).cause } : err
    logger.error('github installation failed', { module: MOD, error: cause })
    return errUrl('installation_failed')
  }

  if (from === 'onboarding') {
    return finish(new URL('/onboarding?github_connected=1', baseUrl))
  }
  return finish(new URL('/integrations?tab=github&github_connected=1', baseUrl))
}
