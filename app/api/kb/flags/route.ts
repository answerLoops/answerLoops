import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { countFlags, listFlags, type FlagStatus } from '@/lib/db/queries/widget-answer-flags'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb/flags'
const STATUSES: readonly FlagStatus[] = ['open', 'resolved', 'dismissed']
const MAX_LIMIT = 200

/**
 * Answers a visitor flagged as wrong, with the question, the reply, the reason
 * and note, and the articles the reply cited. Available on the plans that have
 * the review queue, and to owners and admins only: the items carry text typed
 * by visitors. The response always carries per-status counts so the tab can
 * show how much is waiting; `limit=0` returns the counts alone.
 */
export async function GET(req: NextRequest) {
  try {
    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
    }
    const orgId = access.orgId

    if (!(await orgHasFeature(orgId, 'kb_review_queue'))) {
      return Response.json(
        { error: 'Flagged answers are not available on your plan.', locked: true, requiredPlan: planRequiredFor('kb_review_queue') },
        { status: 402 }
      )
    }

    const statusParam = req.nextUrl.searchParams.get('status') ?? 'open'
    if (!STATUSES.includes(statusParam as FlagStatus)) {
      return Response.json({ error: 'Invalid status' }, { status: 400 })
    }
    const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 100)
    const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 0), MAX_LIMIT) : 100

    const [counts, items] = await Promise.all([
      countFlags(orgId),
      limit === 0 ? Promise.resolve([]) : listFlags(orgId, statusParam as FlagStatus, limit),
    ])
    return Response.json({ counts, items })
  } catch (err) {
    logger.error('failed to load flagged answers', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
