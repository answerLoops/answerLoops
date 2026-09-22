'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { saveFeedback } from '@/lib/db/queries/feedback'

const StaffFeedbackSchema = z.object({
  ticketId: z.coerce.number(),
  vote: z.enum(['up', 'down']),
})

// Staff thumbs up/down on an AI answer from the ticket page. Single shared-login
// staff, so the actor is fixed — one staff vote per ticket.
export async function submitFeedbackAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const parsed = StaffFeedbackSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid input' }

  const { ticketId, vote } = parsed.data
  try {
    saveFeedback({ ticketId, source: 'staff', vote, actor: 'staff' })
  } catch (err) {
    return { error: String(err) }
  }

  refresh()
  return null
}
