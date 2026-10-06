import { requireOrgAccess } from '@/lib/auth/org'
import { getRepos } from '@/lib/db/queries/github'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/github/repos'

export async function GET(req: Request) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
  const orgId = access.orgId

  try {
    return Response.json(await getRepos(orgId))
  } catch (err) {
    logger.error('github repos lookup failed', { module: MOD, requestId: getRequestId(req), orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
