'use server'

import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { isFeedbackWidgetEnabled } from '@/lib/product-feedback/enabled'
import { rateLimitShared } from '@/lib/ratelimit'
import { createProductFeedback, toggleProductFeedbackVote } from '@/lib/db/queries/product-feedback'
import { sendProductFeedbackNotification } from '@/lib/email/send'
import { validateFeedbackBody, type VoteToggleResult } from '@/lib/product-feedback/validation'

// The widget re-fetches on the NOTIFY the table triggers emit, so this action
// does not revalidate a path — the board is not part of any server-rendered
// page. Moderation, replies, and updates are deliberately not in this app:
// operator tooling outside it writes those rows directly, and the table
// triggers push the change to open dashboards.
export type BoardActionResult = { ok: true } | { ok: false; error: string }

/** One click on the up arrow: what happened, or why nothing did. */
export type VoteActionResult =
  | { ok: true; state: Exclude<VoteToggleResult, 'refused'> }
  | { ok: false; error: string }

const HOUR_MS = 60 * 60 * 1000
const SUBMISSIONS_PER_HOUR = 5
// A vote is a toggle people flip and unflip; the cap only has to stop a script.
const VOTES_PER_HOUR = 60

const SubmitSchema = z.object({
  body: z.string(),
  anonymous: z.boolean().default(false),
})

export async function submitProductFeedbackAction(input: unknown): Promise<BoardActionResult> {
  if (!isFeedbackWidgetEnabled()) return { ok: false, error: 'Feedback is not available.' }

  // Any workspace member may submit; the author's org is recorded from a real
  // membership row, never trusted from the client.
  const access = await requireOrgAccess()
  if (!access.ok) return { ok: false, error: access.error }

  const parsed = SubmitSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const body = parsed.data.body.trim()
  const invalid = validateFeedbackBody(body)
  if (invalid) return { ok: false, error: invalid }

  // Database-backed, so the cap holds across app instances and restarts.
  const limited = await rateLimitShared(`product-feedback:${access.userId}`, SUBMISSIONS_PER_HOUR, HOUR_MS)
  if (!limited.ok) {
    return { ok: false, error: 'You have sent a lot of feedback recently. Please try again later.' }
  }

  await createProductFeedback({
    orgId: access.orgId,
    userId: access.userId,
    body,
    anonymous: parsed.data.anonymous,
  })
  // Best-effort alert to the operator; the sender never throws, so a mail
  // outage cannot fail a submission that has already been saved.
  await sendProductFeedbackNotification({ body, anonymous: parsed.data.anonymous })
  return { ok: true }
}

const VoteSchema = z.object({
  feedbackId: z.number().int().positive(),
})

/**
 * Add the caller's up-vote to an entry, or retract it if they already voted.
 * Same guard order as submitting: flag, real membership, input shape, rate
 * limit, then the query. The voter and their workspace come from the session;
 * anything the client sends under those names is ignored. The query itself
 * refuses a vote on the caller's own entry or on one that is not approved, so
 * hiding the arrow in the widget is a courtesy, not the rule.
 */
export async function toggleProductFeedbackVoteAction(input: unknown): Promise<VoteActionResult> {
  if (!isFeedbackWidgetEnabled()) return { ok: false, error: 'Feedback is not available.' }

  const access = await requireOrgAccess()
  if (!access.ok) return { ok: false, error: access.error }

  const parsed = VoteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const limited = await rateLimitShared(`product-feedback-vote:${access.userId}`, VOTES_PER_HOUR, HOUR_MS)
  if (!limited.ok) return { ok: false, error: 'You have been voting a lot. Please try again later.' }

  const state = await toggleProductFeedbackVote({
    feedbackId: parsed.data.feedbackId,
    userId: access.userId,
    orgId: access.orgId,
  })
  if (state === 'refused') return { ok: false, error: 'This entry cannot be voted on.' }
  // No operator mail here: a vote is agreement with feedback that already
  // passed review, not new feedback.
  return { ok: true, state }
}
