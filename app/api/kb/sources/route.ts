import { requireOrgAccess } from '@/lib/auth/org'
import { listKBSources } from '@/lib/db/queries/kb-sources'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/kb/sources'

export async function GET(request: Request) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
    const orgId = access.orgId
    const sources = await listKBSources(orgId)
    return Response.json(sources)
  } catch (err) {
    logger.error('failed to list KB sources', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
