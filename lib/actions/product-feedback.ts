'use server'

import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { isFeedbackWidgetEnabled } from '@/lib/product-feedback/enabled'
import { rateLimitShared } from '@/lib/ratelimit'
import { createProductFeedback, setProductFeedbackVote } from '@/lib/db/queries/product-feedback'
import { sendProductFeedbackNotification } from '@/lib/email/send'
import { validateFeedbackBody, type VoteResult } from '@/lib/product-feedback/validation'

// The widget re-fetches on the NOTIFY the table triggers emit, so this action
// does not revalidate a path — the board is not part of any server-rendered
// page. Moderation, replies, and updates are deliberately not in this app:
// operator tooling outside it writes those rows directly, and the table
// triggers push the change to open dashboards.
export type BoardActionResult = { ok: true } | { ok: false; error: string }

/** One click on the up arrow: the state the vote ended in, or why it could not. */
export type VoteActionResult =
  | { ok: true; state: Exclude<VoteResult, 'refused'> }
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

// The entry id is an INTEGER column; anything past int4 would reach Postgres
// as an out-of-range error instead of a plain refusal.
const MAX_INT4 = 2_147_483_647

const VoteSchema = z.object({
  feedbackId: z.number().int().positive().max(MAX_INT4),
  // The state the person wants, not a toggle: a stale card or a second tab
  // then cannot invert what they meant, and a retried request is harmless.
  voted: z.boolean(),
})

/**
 * Set the caller's up-vote on an entry to the state they asked for. Same
 * guard order as submitting: flag, real membership, input shape, rate limit,
 * then the query. The voter and their workspace come from the session;
 * anything the client sends under those names is ignored. The query itself
 * refuses a vote on the caller's own entry or on one that is not approved, so
 * hiding the arrow in the widget is a courtesy, not the rule.
 */
export async function voteProductFeedbackAction(input: unknown): Promise<VoteActionResult> {
  if (!isFeedbackWidgetEnabled()) return { ok: false, error: 'Feedback is not available.' }

  const access = await requireOrgAccess()
  if (!access.ok) return { ok: false, error: access.error }

  const parsed = VoteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const limited = await rateLimitShared(`product-feedback-vote:${access.userId}`, VOTES_PER_HOUR, HOUR_MS)
  if (!limited.ok) return { ok: false, error: 'You have been voting a lot. Please try again later.' }

  const state = await setProductFeedbackVote({
    feedbackId: parsed.data.feedbackId,
    userId: access.userId,
    orgId: access.orgId,
    voted: parsed.data.voted,
  })
  if (state === 'refused') return { ok: false, error: 'This entry cannot be voted on.' }
  // No operator mail here: a vote is agreement with feedback that already
  // passed review, not new feedback.
  return { ok: true, state }
}
