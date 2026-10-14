import { requireOrgAccess } from '@/lib/auth/org'
import { getEffectiveSLAConfigs } from '@/lib/db/queries/sla'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MOD = 'api/sla'

export async function GET() {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return new Response('Unauthorized', { status: 401 })
    return Response.json(await getEffectiveSLAConfigs(access.orgId))
  } catch (err) {
    logger.error('failed to load SLA targets', { module: MOD, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
