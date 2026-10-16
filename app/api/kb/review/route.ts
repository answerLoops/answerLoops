import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { countReviewItems, listReviewItems, MAX_PENDING_REVIEW_ITEMS, type ReviewStatus } from '@/lib/db/queries/kb-review'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const MOD = 'api/kb/review'
const STATUSES: readonly ReviewStatus[] = ['pending', 'approved', 'rejected']
const MAX_LIMIT = 200

/**
 * The review queue: assistant answers that had no knowledge-base coverage,
 * waiting for a person to fine-tune and approve them. Pro-gated like the other
 * improvement tools; the response always carries per-status counts so the tab
 * can show how much is waiting, plus `full` when the pending queue is at its
 * ceiling and new questions are no longer being captured. `limit=0` returns
 * the counts alone. Owners and admins only.
 */
export async function GET(req: NextRequest) {
  try {
    // Items carry text typed by visitors and customers, so the queue is
    // limited to owners and admins, the same roles that can act on it.
    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
    }
    const orgId = access.orgId

    if (!(await orgHasFeature(orgId, 'kb_review_queue'))) {
      return Response.json(
        { error: 'The review queue is not available on your plan.', locked: true, requiredPlan: planRequiredFor('kb_review_queue') },
        { status: 402 }
      )
    }

    const statusParam = req.nextUrl.searchParams.get('status') ?? 'pending'
    if (!STATUSES.includes(statusParam as ReviewStatus)) {
      return Response.json({ error: 'Invalid status' }, { status: 400 })
    }
    const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 100)
    const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 0), MAX_LIMIT) : 100

    const [counts, items] = await Promise.all([
      countReviewItems(orgId),
      limit === 0 ? Promise.resolve([]) : listReviewItems(orgId, statusParam as ReviewStatus, limit),
    ])
    return Response.json({ counts, items, full: counts.pending >= MAX_PENDING_REVIEW_ITEMS })
  } catch (err) {
    logger.error('failed to load review queue', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
