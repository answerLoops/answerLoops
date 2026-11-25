import { requireOrgAccess } from '@/lib/auth/org'
import { getKnowledgeGapClusters, getGapTicketTotals } from '@/lib/db/queries/analytics'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb/gaps'

/**
 * The open knowledge gaps, the data behind the Gaps tab on the KB page. Plan
 * gated like the old Knowledge Gaps page: workspaces without the feature get
 * `locked: true` and the plan that unlocks it, never the data.
 */
export async function GET(request: Request) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })

    if (!(await orgHasFeature(access.orgId, 'knowledge_gap_dashboard'))) {
      return Response.json({ locked: true, requiredPlan: planRequiredFor('knowledge_gap_dashboard') })
    }

    // The totals count every open gap ticket with one SQL aggregate, so they
    // agree with each other at any size. The list folds repeats of the same
    // question into one row and covers the most pressing of them.
    const [totals, clusters] = await Promise.all([
      getGapTicketTotals(access.orgId),
      getKnowledgeGapClusters(50, access.orgId),
    ])
    return Response.json({ locked: false, totals, clusters })
  } catch (err) {
    logger.error('failed to load knowledge gaps', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
