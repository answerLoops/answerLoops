import {
  getDeflectionStats,
  getDeflectionTrend,
  getCategoryBreakdown,
  getDocGaps,
  getSLAStats,
} from '@/lib/db/queries/analytics'
import { getDeflectionAccuracyByCategory } from '@/lib/db/queries/feedback'
import { getCsatStats } from '@/lib/db/queries/csat'
import { computeSavings, deflectionRate } from '@/lib/analytics/roi'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MOD = 'api/analytics'

// ROI bundle: the numbers that prove the platform's value over time.
export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  try {
    const stats = await getDeflectionStats(orgId)
    return Response.json({
      stats,
      rate: deflectionRate(stats.deflected, stats.answered),
      savings: computeSavings(stats.deflected),
      trend: await getDeflectionTrend(14, orgId),
      categories: await getCategoryBreakdown(orgId),
      docGaps: await getDocGaps(20, orgId),
      sla: await getSLAStats(orgId),
      accuracy: await getDeflectionAccuracyByCategory(orgId),
      csat: (await orgHasFeature(orgId, 'csat_scoring')) ? await getCsatStats(orgId) : null,
    })
  } catch (err) {
    logger.error('failed to compute analytics ROI bundle', { module: MOD, orgId, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
