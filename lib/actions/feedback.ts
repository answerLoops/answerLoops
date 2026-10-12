'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { requireOrgAccess } from '@/lib/auth/org'
import { getTicketById } from '@/lib/db/queries/tickets'
import { saveFeedback } from '@/lib/db/queries/feedback'
import { logger } from '@/lib/logger'

const StaffFeedbackSchema = z.object({
  ticketId: z.coerce.number().int().positive(),
  vote: z.enum(['up', 'down']),
})

// Staff thumbs up/down on an AI answer from the ticket page. One staff vote
// per ticket (the actor is fixed), scoped to the caller's org.
export async function submitFeedbackAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const access = await requireOrgAccess()
  if (!access.ok) return { error: access.error }

  const parsed = StaffFeedbackSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid input' }

  const { ticketId, vote } = parsed.data
  const ticket = await getTicketById(ticketId, access.orgId)
  if (!ticket) return { error: 'Ticket not found' }

  try {
    await saveFeedback({ ticketId, source: 'staff', vote, actor: 'staff' })
  } catch (err) {
    logger.error('failed to save staff feedback', { module: 'actions/feedback', orgId: access.orgId, error: err })
    return { error: 'Could not save feedback. Try again.' }
  }

  refresh()
  return null
}
