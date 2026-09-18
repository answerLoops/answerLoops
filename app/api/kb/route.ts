import { auth } from '@/auth'
import { listArticles } from '@/lib/db/queries/kb'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb'

export async function GET(request: Request) {
  try {
    const session = await auth()
    const orgId = session?.orgId ?? DEFAULT_ORG_ID
    return Response.json(await listArticles(true, orgId))
  } catch (err) {
    logger.error('failed to list KB articles', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
