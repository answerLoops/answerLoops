import { embedText } from '@/lib/ai/embed'
import type { ModelPurpose } from '@/lib/ai/models'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { recordReviewItem, type ReviewSource } from '@/lib/db/queries/kb-review'
import { logger } from '@/lib/logger'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

const MOD = 'kb/review-capture'

const MAX_QUESTION_CHARS = 500
const MAX_ANSWER_CHARS = 4000

/**
 * Puts an answer the assistant gave with no knowledge-base coverage into the
 * org's review queue, so a person can fine-tune it and approve it as an
 * article. Nothing captured here is served to anyone until that approval.
 *
 * Best-effort by design: it runs beside the live answer path (a ticket draft,
 * a widget reply) and must never fail or slow it, so every error is logged and
 * swallowed. Only orgs with the review-queue feature capture anything.
 */
export async function captureUnansweredQuestion(input: {
  orgId: number
  source: ReviewSource
  question: string
  answer: string
  ticketId?: number
  confidence?: number
  // Pass the vector when the caller already has it (the widget does) to skip a
  // second embedding call.
  embedding?: number[]
  purpose?: ModelPurpose
}): Promise<void> {
  try {
    const question = parseAttachmentLines(input.question).text.trim().slice(0, MAX_QUESTION_CHARS)
    const answer = input.answer.trim().slice(0, MAX_ANSWER_CHARS)
    // An empty answer is valid: the assistant had nothing usable, so the
    // reviewer writes one. Only the question is required.
    if (!question) return
    if (!(await orgHasFeature(input.orgId, 'kb_review_queue'))) return

    const embedding = input.embedding ?? (await embedText(question, input.orgId, input.purpose))
    const outcome = await recordReviewItem(
      {
        source: input.source,
        ticketId: input.ticketId ?? null,
        question,
        answer,
        embedding,
        confidence: input.confidence ?? null,
      },
      input.orgId
    )
    if (outcome === 'full') {
      logger.warn('review queue is full — unanswered question not captured', { module: MOD, orgId: input.orgId })
    }
  } catch (err) {
    logger.error('failed to capture unanswered question for review', {
      module: MOD,
      orgId: input.orgId,
      source: input.source,
      error: err,
    })
  }
}
