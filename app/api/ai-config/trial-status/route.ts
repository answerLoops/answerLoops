import { requireOrgAccess } from '@/lib/auth/org'
import { getDeploymentMode } from '@/lib/billing/plans'
import { orgHasAIKey } from '@/lib/db/queries/ai-config'
import { getPlatformKeyTrialStatus } from '@/lib/billing/platform-key-trial'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MOD = 'api/ai-config/trial-status'

// Null means "not applicable" — either self-hosted (no trial concept, the
// platform key is already the self-hoster's own .env) or the org already
// has its own key configured. Only a cloud org with no key gets a real
// trial-status object back.
export async function GET() {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return new Response('Unauthorized', { status: 401 })
    const { orgId } = access

    if (getDeploymentMode() === 'self-hosted' || (await orgHasAIKey(orgId))) {
      return Response.json(null)
    }

    const status = await getPlatformKeyTrialStatus(orgId)
    return Response.json(status)
  } catch (err) {
    logger.error('failed to load platform key trial status', { module: MOD, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
