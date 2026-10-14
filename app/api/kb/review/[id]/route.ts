import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { embedTextWithModel } from '@/lib/ai/embed'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { countArticles } from '@/lib/db/queries/kb'
import { approveReviewItem, rejectReviewItem, reopenReviewItem, type ReviewResolution } from '@/lib/db/queries/kb-review'
import { MAX_ARTICLES_PER_ORG } from '@/lib/kb/limits'
import { rateLimitShared } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/kb/review/[id]'

// Each approval pays for an embedding call, so bound how fast a workspace can
// publish from the queue. Generous for a person clicking through a backlog.
const APPROVE_MAX = 60
const APPROVE_WINDOW_MS = 10 * 60_000

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    question: z.string().trim().min(1, 'Add the question').max(500, 'Question is too long'),
    answer: z.string().trim().min(1, 'Write an answer before approving').max(8000, 'Answer is too long'),
  }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('reopen') }),
])

function resolutionResponse(result: ReviewResolution) {
  if (result.ok) return null
  if (result.reason === 'not_found') return Response.json({ error: 'Item not found' }, { status: 404 })
  return Response.json({ error: 'This item was already reviewed' }, { status: 409 })
}

/**
 * Approve (publishing the edited text as a KB article), reject, or reopen a
 * review item. Approving makes content publicly answerable, so like every
 * other KB write that goes live it is limited to owners and admins.
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
        { error: 'The review queue is not available on your plan.', locked: true, requiredPlan: planRequiredFor('kb_review_queue') },
        { status: 402 }
      )
    }

    const { id } = await ctx.params
    const itemId = Number(id)
    if (!Number.isInteger(itemId) || itemId < 1) return Response.json({ error: 'Invalid ID' }, { status: 400 })

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
    }
    const body = parsed.data

    if (body.action === 'reject') {
      const result = await rejectReviewItem(itemId, orgId, userId)
      return resolutionResponse(result) ?? Response.json({ ok: true })
    }
    if (body.action === 'reopen') {
      const result = await reopenReviewItem(itemId, orgId, userId)
      return resolutionResponse(result) ?? Response.json({ ok: true })
    }

    const limit = await rateLimitShared(`kb-review-approve:${orgId}`, APPROVE_MAX, APPROVE_WINDOW_MS)
    if (!limit.ok) return Response.json({ error: 'Too many approvals — try again in a few minutes.' }, { status: 429 })

    if ((await countArticles(orgId)) >= MAX_ARTICLES_PER_ORG) {
      return Response.json(
        { error: `Knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before approving more.` },
        { status: 400 }
      )
    }

    let embedding: number[]
    let model: string
    try {
      // Same `question\n\nanswer` convention as promote-to-KB and file upload.
      ;({ embedding, model } = await embedTextWithModel(`${body.question}\n\n${body.answer}`, orgId))
    } catch (err) {
      if (err instanceof NoAIProviderConfiguredError) {
        return Response.json(
          { error: aiUnavailableMessage(err, 'No AI provider is set up for this workspace. Add one in Settings → AI Model, then approve again.') },
          { status: 400 }
        )
      }
      logger.error('failed to embed approved review item', { module: MOD, orgId, requestId: getRequestId(req), error: err })
      return Response.json({ error: 'Could not add this answer to the knowledge base. Try again.' }, { status: 502 })
    }

    const result = await approveReviewItem(
      { id: itemId, question: body.question, answer: body.answer, embedding, model, reviewedBy: userId },
      orgId
    )
    return resolutionResponse(result) ?? Response.json({ ok: true, articleId: result.articleId })
  } catch (err) {
    logger.error('failed to update review item', { module: MOD, requestId: getRequestId(req), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
