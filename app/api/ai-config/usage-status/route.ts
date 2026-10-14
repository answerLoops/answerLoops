import { requireOrgAccess } from '@/lib/auth/org'
import { getBudgetStatus } from '@/lib/billing/platform-ai-budget'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MOD = 'api/ai-config/usage-status'

// Null means "not applicable": self-hosted, a workspace with its own key, or
// no live subscription. Otherwise where the workspace stands on included AI
// usage (fractions and flags only, never amounts) and the models it runs on.
export async function GET() {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return new Response('Unauthorized', { status: 401 })
    return Response.json(await getBudgetStatus(access.orgId))
  } catch (err) {
    logger.error('failed to load AI usage status', { module: MOD, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
