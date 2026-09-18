import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { listKBSources } from '@/lib/db/queries/kb-sources'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/kb/sources'

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const orgId = session.orgId ?? DEFAULT_ORG_ID
    const sources = await listKBSources(orgId)
    return Response.json(sources)
  } catch (err) {
    logger.error('failed to list KB sources', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
