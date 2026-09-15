import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { verifyOAuthState } from '@/lib/oauth/state'
import { addRepo } from '@/lib/db/queries/github'
import { listInstallationRepos } from '@/lib/github/app'
import { logger } from '@/lib/logger'

const MOD = 'api/github/callback'

export async function GET(req: NextRequest) {
  const baseUrl = process.env.AUTH_URL ?? req.nextUrl.origin
  const errUrl = (code: string) =>
    NextResponse.redirect(new URL(`/integrations?tab=github&github_error=${code}`, baseUrl))

  const access = await requireOrgAccess()
  if (!access.ok) {
    return NextResponse.redirect(new URL('/login', baseUrl))
  }

  const { searchParams } = req.nextUrl
  const installationId = Number(searchParams.get('installation_id'))

  // The installation is bound to the org named in a state this server signed,
  // and only when the current caller still belongs to that org. Anything else
  // is rejected; there is no default-org fallback.
  let orgId: number
  try {
    const decoded = verifyOAuthState(searchParams.get('state'))
    if (decoded.orgId !== access.orgId) throw new Error('org mismatch')
    orgId = decoded.orgId
  } catch (err) {
    logger.warn('invalid github callback state', { module: MOD, error: err instanceof Error ? err.message : err })
    return errUrl('invalid_state')
  }

  if (!installationId) {
    return errUrl('missing_installation')
  }

  try {
    const repos = await listInstallationRepos(installationId)
    for (const { owner, repo, isPrivate } of repos) {
      await addRepo(installationId, owner, repo, isPrivate, orgId)
    }
    logger.info('github installation connected', { module: MOD, installationId, repoCount: repos.length, orgId })
  } catch (err) {
    const cause = err instanceof Error ? { message: err.message, cause: (err as NodeJS.ErrnoException).cause } : err
    logger.error('github installation failed', { module: MOD, error: cause })
    return errUrl('installation_failed')
  }

  return NextResponse.redirect(new URL('/integrations?tab=github&github_connected=1', baseUrl))
}
