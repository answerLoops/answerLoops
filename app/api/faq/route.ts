import { requireOrgAccess } from '@/lib/auth/org'
import { getLatestFAQ } from '@/lib/db/queries/faq'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/faq'

export async function GET(req: Request) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })

  try {
    const faq = await getLatestFAQ(access.orgId)
    return Response.json(faq ?? { content: null })
  } catch (err) {
    logger.error('faq lookup failed', { module: MOD, requestId: getRequestId(req), orgId: access.orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
