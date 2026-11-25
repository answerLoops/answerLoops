import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { dismissFlag, reopenFlag, resolveFlag, type FlagResolution } from '@/lib/db/queries/widget-answer-flags'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/kb/flags/[id]'

const Body = z.object({ action: z.enum(['resolve', 'dismiss', 'reopen']) })

function resolutionResponse(result: FlagResolution) {
  if (result.ok) return null
  if (result.reason === 'not_found') return Response.json({ error: 'Flag not found' }, { status: 404 })
  return Response.json({ error: 'This flag was already handled' }, { status: 409 })
}

/**
 * Resolve, dismiss or reopen a flagged answer. The change is one conditional
 * update, so two people acting on the same flag at once cannot both succeed:
 * the second gets a 409. Owners and admins only, the same as the review queue.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
    }
    const { orgId, userId } = access

    if (!(await orgHasFeature(orgId, 'kb_review_queue'))) {
      return Response.json(
        { error: 'Flagged answers are not available on your plan.', locked: true, requiredPlan: planRequiredFor('kb_review_queue') },
        { status: 402 }
      )
    }

    const { id } = await ctx.params
    const flagId = Number(id)
    if (!Number.isInteger(flagId) || flagId < 1) return Response.json({ error: 'Invalid ID' }, { status: 400 })

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 })

    const { action } = parsed.data
    const result =
      action === 'resolve'
        ? await resolveFlag(flagId, orgId, userId)
        : action === 'dismiss'
          ? await dismissFlag(flagId, orgId, userId)
          : await reopenFlag(flagId, orgId, userId)
    return resolutionResponse(result) ?? Response.json({ ok: true })
  } catch (err) {
    logger.error('failed to update flagged answer', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
