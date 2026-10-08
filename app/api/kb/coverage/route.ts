import { requireOrgAccess } from '@/lib/auth/org'
import { getKnowledgeCoverage } from '@/lib/db/queries/kb-coverage'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb/coverage'

/**
 * What the chat assistant can answer from, grouped by source — the data behind
 * the Knowledge coverage tab. Org-scoped like every sibling kb route.
 */
export async function GET(request: Request) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
    return Response.json(await getKnowledgeCoverage(access.orgId))
  } catch (err) {
    logger.error('failed to load knowledge coverage', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
