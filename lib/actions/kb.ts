'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { auth } from '@/auth'
import { getTicketById } from '@/lib/db/queries/tickets'
import { createArticle } from '@/lib/db/queries/kb'
import { embedText, EMBEDDING_MODEL } from '@/lib/ai/embed'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

const PromoteSchema = z.object({ ticketId: z.coerce.number() })

export async function promoteToKBAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const parsed = PromoteSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid input' }

  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID

  const ticket = await getTicketById(parsed.data.ticketId, orgId)
  if (!ticket) return { error: 'Ticket not found' }
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return { error: 'Only resolved tickets can be promoted' }
  }

  const answer = ticket.resolution_notes || ticket.ai_draft
  if (!answer) return { error: 'Ticket has no answer to promote' }
  const question = ticket.ai_summary ?? (() => {
    const { text, attachments } = parseAttachmentLines(ticket.content)
    return text.slice(0, 200) || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
  })()

  try {
    const embedding = await embedText(`${question}\n\n${answer}`, orgId)
    await createArticle({ question, answer, embedding, model: EMBEDDING_MODEL, sourceTicketId: ticket.id }, orgId)
  } catch (err) {
    return { error: String(err) }
  }

  refresh()
  return null
}
