import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { getNotionConnection } from '@/lib/db/queries/notion'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/notion'

/** Connection state for the Settings card and the KB-page Notion panel. Never returns the token. */
export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const orgId = (session as { orgId?: number }).orgId ?? DEFAULT_ORG_ID

    const connection = await getNotionConnection(orgId)
    return Response.json({ connection })
  } catch (err) {
    logger.error('failed to load Notion connection', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
