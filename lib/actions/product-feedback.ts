'use server'

import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { isFeedbackWidgetEnabled } from '@/lib/product-feedback/enabled'
import { rateLimitShared } from '@/lib/ratelimit'
import { createProductFeedback } from '@/lib/db/queries/product-feedback'
import { validateFeedbackBody } from '@/lib/product-feedback/validation'

// The widget re-fetches on the NOTIFY the table triggers emit, so this action
// does not revalidate a path — the board is not part of any server-rendered
// page. Moderation, replies, and updates are deliberately not in this app:
// operator tooling outside it writes those rows directly, and the table
// triggers push the change to open dashboards.
export type BoardActionResult = { ok: true } | { ok: false; error: string }

const HOUR_MS = 60 * 60 * 1000
const SUBMISSIONS_PER_HOUR = 5

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
  return { ok: true }
}
