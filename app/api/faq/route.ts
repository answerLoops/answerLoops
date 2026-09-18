import { auth } from '@/auth'
import { getLatestFAQ } from '@/lib/db/queries/faq'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/faq'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const faq = await getLatestFAQ(session.orgId ?? DEFAULT_ORG_ID)
    return Response.json(faq ?? { content: null })
  } catch (err) {
    logger.error('faq lookup failed', { module: MOD, requestId: getRequestId(req), orgId: session.orgId ?? DEFAULT_ORG_ID, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
