import { requireOrgAccess } from '@/lib/auth/org'
import { listArticles } from '@/lib/db/queries/kb'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb'

export async function GET(request: Request) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
    return Response.json(await listArticles(true, access.orgId))
  } catch (err) {
    logger.error('failed to list KB articles', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
